import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes, randomUUID } from "crypto";
import { mediaTypeToExt } from "./assets";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";


export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;
  
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userId = validateJWT(token, cfg.jwtSecret);
  const dbVideo = getVideo(cfg.db, videoId);

  if (!dbVideo) {
    throw new BadRequestError("Unable to retrieve video")
  }
  if (dbVideo?.userID !== userId) {
    throw new UserForbiddenError("Access to video denied");
  }

  const formData = await req.formData();
  const file = formData.get("video")
  
  if ( !(file instanceof File)) {
    throw new BadRequestError("video is not a File");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file exceeds the maximum allowed size of 1GB");
  }

  const mediaType = file.type;
  
  if (!mediaType) {
    throw new BadRequestError("missing content-type for video");
  }
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("mediaType not instance of video or mp4");
  }
  const ext = mediaTypeToExt(mediaType);
  const tempPath = join(tmpdir(), `upload-${randomUUID()}${ext}`);

  await Bun.write(tempPath, file);

  try {
    
    const aspectRatio = await getVideoAspectRatio(tempPath);
    const tempFile = Bun.file(tempPath);

    if (!tempFile.name) {
      throw new BadRequestError("unable to create temp file");
    }
    
    const CFURL = cfg.s3CfDistribution;
    const processedFilename = await processVideoForFastStart(tempFile.name);

    const rand = randomBytes(32);
    const filename = `${aspectRatio}/${ext}`;
    
    const s3File = cfg.s3Client.file(filename);
    await s3File.write(Bun.file(processedFilename), { type: mediaType});

    dbVideo.videoURL = `https://${CFURL}/${filename}`
    updateVideo(cfg.db, dbVideo);
    return respondWithJSON(200, dbVideo);

  } finally {
    await unlink(tempPath);
  }
}

export async function getVideoAspectRatio(filepath: string) {

  const proc = Bun.spawn([
    "ffprobe", 
    "-v", "error",
    "-select_streams", "v:0", 
    "-show_entries", 
    "stream=width,height",
    "-of", "json",
    filepath,
  ], {
    stdout: "pipe",
    stderr: "pipe"
  });

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new BadRequestError("bad request");
  }

  const result = JSON.parse(stdoutText)

  const width = result.streams[0].width;
  const height = result.streams[0].height;
  const ratio = width / height;

  if (0.5 < ratio && ratio < 0.6) {
    return "portrait";
  }  else if (1.7 < ratio && ratio < 1.8) {
    return "landscape";
  } else {
    return "other";
  }
}

export async function processVideoForFastStart(filepath: string) {
  const output = `${filepath}.processed`;
  console.log("output", output)
  
  const proc = Bun.spawn([
    "ffmpeg",
    "-i", filepath,
    "-movflags",
    "faststart", 
    "-map_metadata",
    "0", "-codec",
    "copy", "-f", "mp4", 
    output
  ], {
    stdout: "pipe",
    stderr: "pipe"
  });

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new BadRequestError("bad request");
  }

  return output;
}


