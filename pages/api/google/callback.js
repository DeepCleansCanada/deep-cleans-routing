import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const code = req.query.code;

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
      <html>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h1>Google token received</h1>
          <p>Copy this refresh token into Vercel as <strong>GOOGLE_REFRESH_TOKEN</strong>:</p>
          <pre style="white-space: pre-wrap; word-break: break-word; background: #f4f4f4; padding: 12px; border-radius: 8px;">${tokens.refresh_token || "NO_REFRESH_TOKEN_RETURNED"}</pre>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("callback error:", error);
    return res.status(500).send(
      `<pre style="white-space: pre-wrap;">${error.message || "Callback failed"}</pre>`
    );
  }
}
