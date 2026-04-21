// @ts-nocheck
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import { chromium, BrowserContext, Page } from "playwright";

let browserContext: BrowserContext | null = null;
let activePage: Page | null = null;

async function getPage(): Promise<Page> {
  if (!browserContext) {
    const browser = await chromium.launch({ headless: true });
    browserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
  }
  if (!activePage || activePage.isClosed()) {
    activePage = await browserContext.newPage();
  }
  return activePage;
}

/**
 * Call a Vision-capable LLM (GPT-4o or Claude 3.5 Sonnet) with a screenshot
 * to ask it what it "sees" or where to click.
 */
async function callVisionLLM(base64Image: string, visionPrompt: string): Promise<string> {
  // Try OpenAI GPT-4o first
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: visionPrompt },
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}`, detail: "high" } }
            ]
          }
        ]
      })
    });
    if (response.ok) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? "(no vision response)";
    }
  }

  // Fallback: Try Anthropic Claude 3.5 Sonnet
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: base64Image } },
              { type: "text", text: visionPrompt }
            ]
          }
        ]
      })
    });
    if (response.ok) {
      const data = await response.json();
      return data.content?.[0]?.text ?? "(no vision response)";
    }
  }

  // Fallback: Try Gemini
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  if (geminiKey) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: visionPrompt },
              { inline_data: { mime_type: "image/png", data: base64Image } }
            ]
          }]
        })
      }
    );
    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no vision response)";
    }
  }

  return "(no vision-capable API key found — set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY)";
}

export default definePlugin(({ services }) => ({
  tools: [
    // ─── ORIGINAL TEXT-BASED TOOLS ───
    defineTool({
      name: "browser_navigate",
      description: "Navigate the browser to a URL and return a text representation of the page.",
      actionType: "read",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "The URL to navigate to." }
        }
      },
      async run({ input }) {
        let { url } = input;
        if (!url.startsWith('http')) url = 'https://' + url;
        const page = await getPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        
        const content = await page.evaluate(() => document.body.innerText);
        return { 
          success: true, 
          url: page.url(),
          text_snippet: content.substring(0, 4000) 
        };
      }
    }),
    
    defineTool({
      name: "browser_click",
      description: "Click an element on the current page using a CSS selector or text.",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["selector"],
        properties: {
          selector: { type: "string", description: "CSS selector (e.g., 'button.submit' or 'text=Login')" }
        }
      },
      async run({ input }) {
        const { selector } = input;
        const page = await getPage();
        await page.click(selector);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1000); 
        
        const content = await page.evaluate(() => document.body.innerText);
        return { 
          success: true, 
          url: page.url(),
          new_text_snippet: content.substring(0, 4000) 
        };
      }
    }),
    
    defineTool({
      name: "browser_fill",
      description: "Type text into an input field (search box, login form, etc).",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["selector", "text"],
        properties: {
          selector: { type: "string", description: "CSS selector of the input field." },
          text: { type: "string", description: "The text to type into the field." }
        }
      },
      async run({ input }) {
        const { selector, text } = input;
        const page = await getPage();
        await page.fill(selector, text);
        return { success: true };
      }
    }),

    // ─── VISION-BASED TOOLS (Zero CSS) ───
    defineTool({
      name: "browser_screenshot",
      description: "Take a screenshot of the current page and send it to a Vision AI (GPT-4o / Claude 3.5 Sonnet) with a question. Use this to 'see' a page like a human instead of reading raw HTML/CSS. Perfect for understanding visual layouts, reading charts, or identifying buttons visually.",
      actionType: "read",
      inputSchema: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", description: "What to ask the Vision AI about the screenshot, e.g. 'Describe everything you see on this page' or 'What is the main headline?'" }
        }
      },
      async run({ input }) {
        const { question } = input;
        const page = await getPage();
        const screenshotBuffer = await page.screenshot({ fullPage: false, type: "png" });
        const base64 = screenshotBuffer.toString("base64");
        const visionResponse = await callVisionLLM(base64, question);
        return { 
          success: true, 
          url: page.url(),
          vision_response: visionResponse 
        };
      }
    }),

    defineTool({
      name: "browser_vision_click",
      description: "Use Vision AI to visually locate and click an element on the page WITHOUT needing CSS selectors. Describe what you want to click (e.g. 'the blue Login button', 'the search icon in the top right'). The Vision AI will find it and click it by coordinates. This is immune to CSS/HTML changes.",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["target_description"],
        properties: {
          target_description: { type: "string", description: "Visual description of what to click, e.g. 'the Sign In button' or 'the hamburger menu icon'" }
        }
      },
      async run({ input }) {
        const { target_description } = input;
        const page = await getPage();
        
        // Take screenshot for the Vision AI
        const screenshotBuffer = await page.screenshot({ fullPage: false, type: "png" });
        const base64 = screenshotBuffer.toString("base64");
        
        // Ask the Vision AI to return precise coordinates
        const coordPrompt = [
          `You are a pixel-perfect UI coordinate detector. The browser viewport is 1280x720 pixels.`,
          `The user wants to click: "${target_description}"`,
          `Look at the screenshot and return ONLY a JSON object with the x,y pixel coordinates of the center of that element.`,
          `Format: {"x": 640, "y": 360}`,
          `If you cannot find the element, return: {"x": -1, "y": -1, "error": "Element not found"}`
        ].join("\n");
        
        const visionResponse = await callVisionLLM(base64, coordPrompt);
        
        // Parse coordinates from the Vision AI response
        let coords;
        try {
          const jsonMatch = visionResponse.match(/\{[\s\S]*?\}/);
          coords = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch {
          return { success: false, error: `Vision AI returned unparseable coordinates: ${visionResponse}` };
        }
        
        if (!coords || coords.x === -1) {
          return { success: false, error: coords?.error ?? `Could not visually locate: "${target_description}"` };
        }
        
        // Click the exact pixel coordinates
        await page.mouse.click(coords.x, coords.y);
        await page.waitForTimeout(1500);
        
        const content = await page.evaluate(() => document.body.innerText);
        return { 
          success: true, 
          clicked_at: { x: coords.x, y: coords.y },
          url: page.url(),
          new_text_snippet: content.substring(0, 4000)
        };
      }
    }),

    defineTool({
      name: "browser_vision_fill",
      description: "Use Vision AI to visually locate an input field and type into it WITHOUT CSS selectors. Describe the field visually (e.g. 'the search bar at the top', 'the email input field').",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["field_description", "text"],
        properties: {
          field_description: { type: "string", description: "Visual description of the input field to type into." },
          text: { type: "string", description: "The text to type." }
        }
      },
      async run({ input }) {
        const { field_description, text } = input;
        const page = await getPage();
        
        const screenshotBuffer = await page.screenshot({ fullPage: false, type: "png" });
        const base64 = screenshotBuffer.toString("base64");
        
        const coordPrompt = [
          `You are a pixel-perfect UI coordinate detector. The browser viewport is 1280x720 pixels.`,
          `The user wants to click on an input field described as: "${field_description}"`,
          `Look at the screenshot and return ONLY a JSON object with the x,y pixel coordinates of the center of that input field.`,
          `Format: {"x": 640, "y": 360}`,
          `If you cannot find the element, return: {"x": -1, "y": -1, "error": "Element not found"}`
        ].join("\n");
        
        const visionResponse = await callVisionLLM(base64, coordPrompt);
        
        let coords;
        try {
          const jsonMatch = visionResponse.match(/\{[\s\S]*?\}/);
          coords = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch {
          return { success: false, error: `Vision AI returned unparseable coordinates: ${visionResponse}` };
        }
        
        if (!coords || coords.x === -1) {
          return { success: false, error: coords?.error ?? `Could not visually locate: "${field_description}"` };
        }
        
        // Click the field, then type
        await page.mouse.click(coords.x, coords.y);
        await page.waitForTimeout(300);
        await page.keyboard.type(text, { delay: 30 });
        
        return { 
          success: true,
          typed_at: { x: coords.x, y: coords.y },
          text_entered: text
        };
      }
    })
  ]
}));
