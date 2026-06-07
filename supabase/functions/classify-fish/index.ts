import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

type FishSpecies = {
  id: number;
  name: string;
  scientific_name: string;
  habitat: string;
  rarity_stars: number;
  is_rare: boolean;
};

type FishClassification = {
  matched_species_name: string | null;
  confidence: number;
  reasoning: string;
  alternatives: Array<{
    species_name: string;
    confidence: number;
  }>;
};

const maxImageBytes = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const openAiApiKey = requiredEnv("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData } = await authClient.auth.getUser();
    const user = userData.user;
    if (!user) {
      return jsonResponse({ error: "Sign in is required to classify fish images." }, 401);
    }

    await ensureProfile(serviceClient, user.id);

    const imageDataUrl = await readImageDataUrl(req);
    const speciesCatalog = await loadSpeciesCatalog(serviceClient);
    const classification = await classifyFishWithOpenAI({
      apiKey: openAiApiKey,
      model,
      imageDataUrl,
      speciesCatalog,
    });

    const matchedSpecies = speciesCatalog.find((species) =>
      species.name.toLowerCase() === classification.matched_species_name?.toLowerCase()
    ) ?? null;

    const catchRecord = matchedSpecies
      ? await upsertCatch(serviceClient, user.id, matchedSpecies.id)
      : null;

    return jsonResponse({
      classification,
      species: matchedSpecies,
      catch: catchRecord,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});

async function ensureProfile(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  const { error } = await serviceClient
    .from("profiles")
    .upsert({ id: userId }, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

async function loadSpeciesCatalog(
  serviceClient: ReturnType<typeof createClient>,
): Promise<FishSpecies[]> {
  const { data, error } = await serviceClient
    .from("fish_species")
    .select("id, name, scientific_name, habitat, rarity_stars, is_rare")
    .order("name");

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function upsertCatch(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  speciesId: number,
): Promise<unknown> {
  const { data, error } = await serviceClient
    .from("user_catches")
    .upsert(
      {
        user_id: userId,
        species_id: speciesId,
      },
      { onConflict: "user_id,species_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function readImageDataUrl(req: Request): Promise<string> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("image");

    if (!(file instanceof File)) {
      throw new Error("Expected multipart field named 'image'.");
    }

    assertImage(file.type, file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return toDataUrl(bytes, file.type);
  }

  if (contentType.includes("application/json")) {
    const body = await req.json();

    if (typeof body.imageDataUrl === "string") {
      assertDataUrl(body.imageDataUrl);
      return body.imageDataUrl;
    }

    if (typeof body.imageBase64 === "string") {
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
      assertImage(mimeType, estimateBase64Bytes(body.imageBase64));
      return `data:${mimeType};base64,${body.imageBase64}`;
    }

    if (typeof body.imageUrl === "string") {
      return body.imageUrl;
    }
  }

  throw new Error("Send multipart/form-data with 'image', or JSON with imageDataUrl, imageBase64, or imageUrl.");
}

async function classifyFishWithOpenAI(input: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  speciesCatalog: FishSpecies[];
}): Promise<FishClassification> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Identify the fish in this image for the Fishedex app.",
              "Only match against one of these existing fish_species.name values.",
              "If the image is not a fish or does not confidently match the catalog, return matched_species_name as null.",
              `Catalog: ${input.speciesCatalog.map((species) => species.name).join(", ")}`,
            ].join("\n"),
          },
          {
            type: "input_image",
            image_url: input.imageDataUrl,
            detail: "high",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "fish_classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["matched_species_name", "confidence", "reasoning", "alternatives"],
            properties: {
              matched_species_name: {
                type: ["string", "null"],
                enum: [...input.speciesCatalog.map((species) => species.name), null],
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reasoning: { type: "string" },
              alternatives: {
                type: "array",
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["species_name", "confidence"],
                  properties: {
                    species_name: {
                      type: "string",
                      enum: input.speciesCatalog.map((species) => species.name),
                    },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "OpenAI classification request failed.");
  }

  const outputText = payload.output_text ?? payload.output?.[0]?.content?.[0]?.text;

  if (typeof outputText !== "string") {
    throw new Error("OpenAI response did not include parseable output text.");
  }

  return JSON.parse(outputText) as FishClassification;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function assertImage(mimeType: string, size: number): void {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (!allowed.includes(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  if (size > maxImageBytes) {
    throw new Error("Image is too large. Maximum size is 10 MiB.");
  }
}

function assertDataUrl(dataUrl: string): void {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|heic|heif));base64,(.+)$/);
  if (!match) {
    throw new Error("imageDataUrl must be a base64 data URL for jpeg, png, webp, heic, or heif.");
  }

  assertImage(match[1], estimateBase64Bytes(match[2]));
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

