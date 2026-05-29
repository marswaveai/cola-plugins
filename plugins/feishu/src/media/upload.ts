import fs from "fs";
import type * as lark from "@larksuiteoapi/node-sdk";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import { mimeFromExt, feishuFileType } from "./mime.js";
import path from "path";

/**
 * Upload an image to Feishu and return the image_key.
 */
export async function uploadImage(
  client: lark.Client,
  filePath: string,
  logger: PluginLogger,
): Promise<string | undefined> {
  try {
    const buffer = fs.readFileSync(filePath);
    const resp = await client.im.image.create({
      data: {
        image_type: "message",
        image: buffer,
      },
    });
    return resp?.image_key ?? undefined;
  } catch (err) {
    logger.warn(`Failed to upload image: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Upload a file to Feishu and return the file_key.
 */
export async function uploadFile(
  client: lark.Client,
  filePath: string,
  logger: PluginLogger,
): Promise<string | undefined> {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const mime = mimeFromExt(ext);
    const fileType = feishuFileType(mime);
    const fileName = path.basename(filePath);

    const resp = await client.im.file.create({
      data: {
        file_type: fileType as "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream",
        file_name: fileName,
        file: buffer,
      },
    });
    return resp?.file_key ?? undefined;
  } catch (err) {
    logger.warn(`Failed to upload file: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
