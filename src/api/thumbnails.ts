import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";


export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userId = validateJWT(token, cfg.jwtSecret);
  
  console.log("uploading thumbnail for video", videoId, "by user", userId);

  const data = await req.formData();
  const thumbnail = data.get("thumbnail");

  if ( ! (thumbnail instanceof File)) {
    throw new BadRequestError("thumbnail is not a File");
  }

  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
  const mediaType = thumbnail.type;

  const arrayBuffer = await thumbnail.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const bufferBase64 = buffer.toString("base64");

  const video = getVideo(cfg.db, videoId);

  if (video?.userID !== userId) {
    throw new UserForbiddenError("Access to video denied");
  }

  if (!video) {
    throw new BadRequestError("Unable to retrieve video")
  }

  const dataURL = `data:${mediaType};base64,${bufferBase64}`;

  video.thumbnailURL = dataURL;
  updateVideo(cfg.db, video);
 
  return respondWithJSON(200, video);
}
