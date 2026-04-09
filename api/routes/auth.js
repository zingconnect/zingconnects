import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"; // Added
import { agentSchema } from '../models/Agent.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// --- IDRIVE E2 CONFIG (Must match your index.js) ---
const s3Client = new S3Client({
  region: process.env.IDRIVE_REGION,
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY,
  },
});

const getAgentModel = () => {
  return mongoose.models.Agent || mongoose.model('Agent', agentSchema);
};

router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    const Agent = getAgentModel();

    const {
      firstName, lastName, email, password, address,
      occupation, program, bio, dob, gender, plan
    } = req.body;

    // 1. SECURITY: Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 2. SLUG GENERATION
    const baseSlug = `${firstName}${lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();

    let finalSlug = baseSlug;
    let counter = 1;
    let slugExists = await Agent.findOne({ slug: finalSlug });

    while (slugExists) {
      counter++;
      const suffix = counter < 10 ? `-0${counter}` : `-${counter}`;
      finalSlug = `${baseSlug}${suffix}`;
      slugExists = await Agent.findOne({ slug: finalSlug });
    }

    // 3. PHOTO HANDLING (FIXED: IDrive Upload Logic)
    let savedPhotoPath = ""; 
    if (req.file) {
      try {
        const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
        const fileKey = `profiles/${fileName}`;
        const bucketName = process.env.IDRIVE_BUCKET_NAME || "livechat";
        
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }));
        
        // Construct the IDrive URL
        const rawEndpoint = (process.env.IDRIVE_ENDPOINT || "").replace('https://', '');
        savedPhotoPath = `https://${bucketName}.${rawEndpoint}/${fileKey}`;
        console.log("Image Uploaded to IDrive:", savedPhotoPath);
      } catch (s3Error) {
        console.error("S3 Upload Failed in auth.js:", s3Error.message);
        // We don't crash the whole request, but the user won't have a photoUrl
      }
    }

    // 4. CREATE AGENT
    const newAgent = new Agent({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      address,
      occupation,
      program: program || "N/A",
      bio: bio || "",
      dob,
      gender,
      slug: finalSlug,
      photoUrl: savedPhotoPath, // Now contains the IDrive link
      plan: plan || 'BASIC',
      role: 'agent',
      status: 'active',
      isSubscribed: false 
    });

    await newAgent.save();

    res.status(201).json({ 
      success: true,
      message: "Agent profile created successfully!", 
      slug: finalSlug,
      photoUrl: savedPhotoPath
    });
    
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(error.code === 11000 ? 400 : 500).json({
      success: false,
      message: error.code === 11000 ? "Email already exists" : "Internal Server Error"
    });
  }
});

export default router;