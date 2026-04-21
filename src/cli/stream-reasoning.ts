// @ts-nocheck
import process from "node:process";
import { loadEnvFile } from "../lib/env-loader.js";

loadEnvFile();

const API_KEY = process.env.OPENROUTER_API_KEY || "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";

async function main() {
  console.log("Connecting to OpenRouter (arcee-ai/trinity-large-preview:free)...\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "SOVEREIGN Platform"
    },
    body: JSON.stringify({
      model: "arcee-ai/trinity-large-preview:free",
      messages: [
        {
          role: "user",
          content: "How many r's are in the word 'strawberry'?"
        }
      ],
      stream: true,
      stream_options: { include_usage: true }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let reasoningTokens = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    // Parse SSE chunk stream
    const chunkData = decoder.decode(value, { stream: true });
    const lines = chunkData.split("\n").filter(line => line.trim().startsWith("data: "));
    
    for (const line of lines) {
      if (line.includes("[DONE]")) continue;
      
      try {
        const chunk = JSON.parse(line.replace("data: ", ""));
        
        // Print streaming text
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          process.stdout.write(content);
        }

        // Print usage information when it arrives in the final chunk
        if (chunk.usage) {
          reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens || chunk.usage.reasoningTokens || 0;
        }
      } catch (e) {
        // partial chunk, ignore and continue
      }
    }
  }

  console.log("\n");
  console.log("----------------------------------------");
  console.log(`Reasoning tokens: ${reasoningTokens}`);
  console.log("----------------------------------------");
}

main().catch(console.error);
