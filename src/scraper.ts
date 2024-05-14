import puppeteer, { type Page } from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import { URL } from "url";

// Load environment variables from .env file
config();

// Configure AWS S3
const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
  region: process.env.AWS_DEFAULT_REGION,
});

const BUCKET_NAME = "larry-king-data";
const MAX_DEPTH = 3;

async function goToURL(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: "networkidle2" });
  } catch (error) {
    console.error(`Failed to go to URL: ${url}`);
    throw error;
  }
}

function parseTranscript(
  transcript: string
): Array<{ speaker: string; value: string }> {
  const speakerPattern = /^([\w'",\s.]+):\s*(.*)$/;
  const parsedTranscript: Array<{ speaker: string; value: string }> = [];
  let currentSpeaker = "system"; // Default speaker

  transcript.split("<br>").forEach((line) => {
    line = line.trim();
    if (!line) return;

    if (
      line.startsWith("(") &&
      line.endsWith(")") &&
      line.toUpperCase() === line
    ) {
      parsedTranscript.push({ speaker: "system", value: line });
      return;
    }

    const speakerMatch = speakerPattern.exec(line);
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1].includes("KING")
        ? "assistant"
        : speakerMatch[1];
      const dialogue = speakerMatch[2].trim();
      parsedTranscript.push({ speaker: currentSpeaker, value: dialogue });
    } else {
      parsedTranscript.push({ speaker: currentSpeaker, value: line });
    }
  });
  console.log(parsedTranscript);

  const consolidatedTranscript = [];
  let lastSpeaker: string | null = null;
  let lastValue = "";

  parsedTranscript.forEach((entry) => {
    if (lastSpeaker === entry.speaker) {
      lastValue += ` ${entry.value}`;
    } else {
      if (lastSpeaker !== null) {
        consolidatedTranscript.push({ speaker: lastSpeaker, value: lastValue });
      }
      lastSpeaker = entry.speaker;
      lastValue = entry.value;
    }
  });

  // Add the last entry if there is one
  if (lastSpeaker !== null) {
    consolidatedTranscript.push({ speaker: lastSpeaker, value: lastValue });
  }

  console.log(consolidatedTranscript);
  return consolidatedTranscript;
}

async function fetchAndUploadTranscript({
  page,
  url,
  startingUrl,
}: {
  page: Page;
  url: string;
  startingUrl: string;
}) {
  await goToURL(page, url);
  const content = await page.evaluate(() => {
    const elements = document.querySelectorAll(".cnnBodyText");
    const content = Array.from(elements)
      .map((element) => element.innerHTML)
      .join("<br>");
    return content;
  });
  const parsedContent = parseTranscript(content);

  const s3Key = generateS3Key({ url, startingUrl });
  const data = JSON.stringify(parsedContent, null, 2);

  // try {
  //   const putObjectCommand = new PutObjectCommand({
  //     Bucket: BUCKET_NAME,
  //     Key: s3Key,
  //     Body: data,
  //   });
  //   await s3Client.send(putObjectCommand);
  //   console.log(`Successfully uploaded ${s3Key}`);
  // } catch (error) {
  //   console.error(`Failed to upload to S3: ${error}`);
  // }
}

function generateS3Key({
  url,
  startingUrl,
}: {
  url: string;
  startingUrl: string;
}): string {
  const urlParsed = new URL(url);
  const endingUrl = url.replace(startingUrl, "");
  const pathSegments = endingUrl.replace(/^\/+|\/+$/g, "");
  const query = urlParsed.searchParams.toString();
  const querySemgment = query ? `_${query}` : "";
  return `${pathSegments}${querySemgment}.json`;
}

async function main(startingUrl: string) {
  const indexURL = new URL(startingUrl);
  const baseUrl = `${indexURL.protocol}//${indexURL.hostname}`;

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  async function crawlTranscripts({
    url,
    currentDepth = 0,
  }: {
    url: string;
    currentDepth?: number;
  }) {
    if (currentDepth > MAX_DEPTH) {
      await browser.close();
      return;
    }

    await goToURL(page, url);
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"), (a) =>
        a.getAttribute("href")
      ).filter((href): href is string => href !== null)
    );

    for (const link of links) {
      const fullUrl = new URL(link, baseUrl).toString();
      if (fullUrl.startsWith(startingUrl) && fullUrl !== url) {
        // Filter to only process subpages of the base URL and avoid loops
        await fetchAndUploadTranscript({ page, url: fullUrl, startingUrl });
        return;
      }
    }

    if (currentDepth === 0) {
      await browser.close();
    }
  }

  await crawlTranscripts({ url: startingUrl });
}

// Example usage
main("https://transcripts.cnn.com/show/lkl");
