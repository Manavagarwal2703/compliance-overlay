import { NextResponse } from "next/server";
import { createHmac } from "crypto";

function base64urlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const secret = process.env.JWT_SECRET || "default_dev_secret";
  
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { 
    userId: "dev_user_001",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60) // 2 hours
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  
  const encodedSignature = signature
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const token = `${signingInput}.${encodedSignature}`;

  const response = NextResponse.json({ success: true, message: "Dev auth token generated", token });

  return response;
}
