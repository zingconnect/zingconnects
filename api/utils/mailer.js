import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

export const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOfflineNotification = async (receiver, sender, text, receiverType) => {
  try {
    const baseUrl = "https://zingconnect.vercel.app";
    const logoUrl = `${baseUrl}/icon.png`;
    
    // --- 1. HANDLE ATTACHMENTS VS TEXT ---
    // If text is empty or null (common in picture uploads), provide a fallback string
    const displayBody = text && text.trim() !== "" 
      ? text 
      : "Sent an attachment (Image/Video)";

    const path = receiverType === 'Agent' 
      ? `/agent/dashboard?userId=${sender._id}` 
      : `/user/dashboard?agentId=${sender._id}`;
    
    const callbackUrl = `${baseUrl}${path}`;
    const brandColor = "#007bff"; 

    // --- 2. DYNAMIC SUBJECT LINE ---
    const subjectPrefix = text ? "New message" : "New attachment";
    const subject = receiverType === 'Agent' 
        ? `${subjectPrefix} from client ${sender.firstName || 'User'}` 
        : `${subjectPrefix} from ${sender.firstName || 'Zing Agent'}`;

    const mailOptions = {
      from: `"ZingConnect" <${process.env.EMAIL_USER}>`,
      to: receiver.email,
      subject: subject,
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden;">
          <div style="padding: 20px; text-align: center; border-bottom: 1px solid #f0f0f0; background-color: #ffffff;">
            <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
              <tr>
                <td style="vertical-align: middle; padding-right: 10px;">
                  <img src="${logoUrl}" alt="ZingConnect Logo" width="30" height="30" style="display: block; width: 30px; height: 30px; border-radius: 4px;">
                </td>
                <td style="vertical-align: middle;">
                  <h1 style="font-size: 22px; color: ${brandColor}; margin: 0; line-height: 30px; font-weight: bold;">ZingConnect</h1>
                </td>
              </tr>
            </table>
          </div>
          <div style="padding: 30px; background-color: #ffffff;">
            <p style="font-size: 16px;">Hi <strong>${receiver.firstName || 'there'}</strong>,</p>
            <p style="font-size: 16px;">You have a ${text ? 'new message' : 'new attachment'} from <strong>${sender.firstName || 'System'}</strong>:</p>
            
            <div style="background-color: #f8f9fa; border-left: 4px solid ${brandColor}; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0;">
              <p style="margin: 0; font-style: italic; color: #555; line-height: 1.5;">
                "${displayBody.substring(0, 250)}${displayBody.length > 250 ? '...' : ''}"
              </p>
            </div>

            <div style="text-align: center; margin-top: 30px;">
              <a href="${callbackUrl}" 
                 style="background-color: ${brandColor}; color: #ffffff; padding: 14px 30px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold; font-size: 16px;">
                 ${text ? 'View Message & Reply' : 'View Attachment'}
              </a>
            </div>
          </div>
          <div style="background-color: #fcfcfc; padding: 20px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #f0f0f0;">
            You received this because you were offline when the message was sent. <br/>
            &copy; 2026 ZingConnect.
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email] ${receiverType} notification sent to ${receiver.email}`);
  } catch (err) {
    console.error("Mailer Error:", err.message);
  }
};