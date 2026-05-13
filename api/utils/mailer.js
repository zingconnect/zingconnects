import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOfflineNotification = async (receiver, sender, text, receiverType) => {
  try {
    const baseUrl = "https://zingconnect.vercel.app";
    
const logoUrl = `${BASE_URL}/icon.png`;
    const path = receiverType === 'Agent' 
      ? `/agent/dashboard?userId=${sender._id}` 
      : `/user/dashboard?agentId=${sender._id}`;
    
    const callbackUrl = `${baseUrl}${path}`;
    const brandColor = "#007bff"; 

    const mailOptions = {
      from: `"ZingConnect" <${process.env.EMAIL_USER}>`,
      to: receiver.email,
      subject: receiverType === 'Agent' 
        ? `New client message from ${sender.firstName}` 
        : `Message from ${sender.firstName || 'Zing Agent'}`,
      html: `
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
          <div style="padding: 30px;">
            <p>Hi <strong>${receiver.firstName || 'there'}</strong>,</p>
            <p>You have a new message from <strong>${sender.firstName || 'System'}</strong>:</p>
            <div style="background-color: #f8f9fa; border-left: 4px solid ${brandColor}; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-style: italic;">
                "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"
              </p>
            </div>
            <div style="text-align: center; margin-top: 30px;">
              <a href="${callbackUrl}" 
                 style="background-color: ${brandColor}; color: #ffffff; padding: 14px 30px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">
                 View Message & Reply
              </a>
            </div>
          </div>
          <div style="background-color: #fcfcfc; padding: 20px; text-align: center; font-size: 12px; color: #999;">
            You received this because you were offline. <br/>
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