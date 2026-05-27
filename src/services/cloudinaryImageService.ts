import { v2 as cloudinary, UploadApiResponse } from "cloudinary";

let configured = false;

export const isCloudinaryConfigured = () => Boolean(
  process.env.CLOUDINARY_URL ||
  (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  )
);

const configureCloudinary = () => {
  if (configured) return;

  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Backend chua cau hinh Cloudinary. Vui long them CLOUDINARY_URL hoac CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET."
    );
  }

  if (!process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
  }

  configured = true;
};

export const uploadImageBufferToCloudinary = (
  buffer: Buffer,
  folder: string
) => new Promise<UploadApiResponse>((resolve, reject) => {
  configureCloudinary();

  const stream = cloudinary.uploader.upload_stream(
    {
      folder,
      resource_type: "image",
      quality: "auto",
      fetch_format: "auto"
    },
    (error, result) => {
      if (error || !result) {
        reject(error || new Error("Khong nhan duoc ket qua upload tu Cloudinary"));
        return;
      }
      resolve(result);
    }
  );

  stream.end(buffer);
});

export const deleteCloudinaryImage = async (publicId?: string | null) => {
  if (!publicId) return;
  configureCloudinary();
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
};
