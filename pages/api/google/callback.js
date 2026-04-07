import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Missing code");
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    return res.status(200).send(`
      <h1>Google token received</h1>
      <p>Copy this refresh token into Vercel as <b>GOOGLE_REFRESH_TOKEN</b>:</p>
      <pre>${tokens.refresh_token}</pre>
    `);
  } catch (error) {
    console.error("callback error:", error);
    return res.status(500).send("OAuth failed");
  }
}
