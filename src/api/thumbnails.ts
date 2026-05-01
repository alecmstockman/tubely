import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { mediaTypeToExt, getAssetDiskPath, getAssetURL } from "./assets";


export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userId = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new BadRequestError("Unable to retrieve video")
  }
  if (video?.userID !== userId) {
    throw new UserForbiddenError("Access to video denied");
  }

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if ( ! (file instanceof File)) {
    throw new BadRequestError("thumbnail is not a File");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(
      `Thumbnail file exceeds the maximum allowed size of 10MB`,
    );
  }

  const mediaType = file.type
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new BadRequestError("mediaType not instance of jpeg or png");
  }

  const ext = mediaTypeToExt(mediaType);
  const filename = `${videoId}${ext}`

  const assetDiskPath = getAssetDiskPath(cfg, filename)
  await Bun.write(assetDiskPath, file)

  const urlPath = getAssetURL(cfg, filename);
  video.thumbnailURL = urlPath;

  updateVideo(cfg.db, video);
 
  return respondWithJSON(200, video);
}
