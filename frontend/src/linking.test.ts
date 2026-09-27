import assert from "node:assert/strict";
import { normalizeIncomingLink } from "./linking.ts";

const id = "11111111-2222-4333-8444-555555555555";

function check(input: string, expected: string | null) {
  assert.equal(normalizeIncomingLink(input), expected, input);
}

check(`ironflow://post/${id}`, `/post/${id}`);
check(`ironflow:///post/${id}`, `/post/${id}`);
check(`ironflow:////post/${id}`, `/post/${id}`);
check(`ironflow://live/${id}`, `/live/${id}`);
check(`ironflow:///live/${id}`, `/live/${id}`);
check(`ironflow://post/${id}?ref=share`, `/post/${id}?ref=share`);
check(`IRONFLOW://post/${encodeURIComponent(id)}`, `/post/${id}`);
check(`ironflow://POST/${id}`, `/post/${id}`);
check(`ironflow:///LIVE/${id}`, `/live/${id}`);
check(`exp://127.0.0.1:8081/--/post/${id}`, `/post/${id}`);
check(`exps://192.168.1.5:8081/--/live/${id}`, `/live/${id}`);
check(`/post/${id}`, `/post/${id}`);
check(`post/${id}`, `/post/${id}`);
check("ironflow:///", null);
check("ironflow://", null);
check(`ironflow://invite/abc`, null);
check(`ironflow://expo-development-client/?url=1`, null);
check(`ironflow://post/`, null);
check(`ironflow://post/../admin`, null);
check("ironflow://post/a%20b", "/post/a%20b");

const previousOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN;
const previousUrl = process.env.EXPO_PUBLIC_WEB_URL;

process.env.EXPO_PUBLIC_WEB_ORIGIN = "https://ironflow.example/";
delete process.env.EXPO_PUBLIC_WEB_URL;
check(`https://ironflow.example/post/${id}`, `/post/${id}`);
check(`https://ironflow.example/live/${id}?x=1`, `/live/${id}?x=1`);
check("https://other.example/post/nope", null);

delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
process.env.EXPO_PUBLIC_WEB_URL = "http://localhost:8081";
check(`http://localhost:8081/post/${id}`, `/post/${id}`);
check(`http://localhost:8081/live/${id}`, `/live/${id}`);

if (previousOrigin === undefined) delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
else process.env.EXPO_PUBLIC_WEB_ORIGIN = previousOrigin;
if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_WEB_URL;
else process.env.EXPO_PUBLIC_WEB_URL = previousUrl;

console.log("linking tests passed");
