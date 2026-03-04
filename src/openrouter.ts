export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const OPENROUTER_ENDPOINT = process.env.OPENROUTER_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export async function streamOpenRouter(messages: {role: string, content: string}[], onChunk: (text: string) => void) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://aiktivist.local", 
      "X-Title": "Aiktivist",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      stream: true,
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API Error: ${response.status} ${err}`);
  }

  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    
    let boundary = buffer.indexOf("\\n");
    while (boundary !== -1) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const json = JSON.parse(line.slice(6));
          const chunk = json.choices[0]?.delta?.content || "";
          if (chunk) {
            onChunk(chunk);
          }
        } catch (e) {
          console.error("Failed to parse chunk:", line);
        }
      }
      boundary = buffer.indexOf("\\n");
    }
  }
}
