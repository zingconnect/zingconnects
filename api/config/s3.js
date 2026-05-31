import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"; 
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage"; 

let _s3Client;

export const getS3Client = () => {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: process.env.IDRIVE_REGION,
      endpoint: process.env.IDRIVE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
        secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3Client;
};

// Re-export this for your auth.js registration logic
export { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const getPrivateUrl = async (fileKey) => {
  if (!fileKey) return fileKey;
  
  try {
    const client = getS3Client(); 
    
    const actualKey = fileKey.includes('.com/') 
      ? fileKey.split('.com/')[1].split('?')[0] 
      : fileKey;

    const command = new GetObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: decodeURIComponent(actualKey),
    });

    return await getSignedUrl(client, command, { expiresIn: 3600 });
  } catch (err) {
    console.error("Signing Error:", err.message);
    return fileKey; 
  }
};

// 🛠️ NEW EXPORT: Handles your clean file uploads safely
export const uploadToS3 = async (file, folder = 'users') => {
  const client = getS3Client();
  const fileExtension = file.originalname.split('.').pop() || 'jpg';
  const uniqueFileName = `${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}.${fileExtension}`;
  const storageKey = `${folder}/${uniqueFileName}`;

  const uploadWorker = new Upload({
    client,
    params: {
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: storageKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    },
  });

  await uploadWorker.done();
  return storageKey; // Returns "users/filename.jpg"
};