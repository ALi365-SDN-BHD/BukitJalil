import { Bot, Orbit } from "lucide-react";
import anthropic from "@/assets/providers/anthropic.svg";
import azure from "@/assets/providers/azure-color.svg";
import baseten from "@/assets/providers/baseten.svg";
import bedrock from "@/assets/providers/bedrock-color.svg";
import cerebras from "@/assets/providers/cerebras-color.svg";
import cloudflare from "@/assets/providers/cloudflare-color.svg";
import codex from "@/assets/providers/codex-color.svg";
import deepseek from "@/assets/providers/deepseek-color.svg";
import fireworks from "@/assets/providers/fireworks-color.svg";
import githubcopilot from "@/assets/providers/githubcopilot.svg";
import google from "@/assets/providers/google-color.svg";
import groq from "@/assets/providers/groq.svg";
import huggingface from "@/assets/providers/huggingface-color.svg";
import kimi from "@/assets/providers/kimi-color.svg";
import ling from "@/assets/providers/ling-color.svg";
import meta from "@/assets/providers/meta-color.svg";
import minimax from "@/assets/providers/minimax-color.svg";
import mistral from "@/assets/providers/mistral-color.svg";
import moonshot from "@/assets/providers/moonshot.svg";
import nvidia from "@/assets/providers/nvidia-color.svg";
import openai from "@/assets/providers/openai.svg";
import opencode from "@/assets/providers/opencode.svg";
import openrouter from "@/assets/providers/openrouter-color.svg";
import qwen from "@/assets/providers/qwen-color.svg";
import together from "@/assets/providers/together-color.svg";
import typesafeai from "@/assets/providers/typesafeai.svg";
import vercel from "@/assets/providers/vercel.svg";
import vertexai from "@/assets/providers/vertexai-color.svg";
import xai from "@/assets/providers/xai.svg";
import xiaomimimo from "@/assets/providers/xiaomimimo.svg";
import zai from "@/assets/providers/zai.svg";

/**
 * Brand marks from @lobehub/icons-static-svg 1.102.0 (MIT), used only to identify the providers.
 * Color variants are used where the package has one; unknown providers get a generic mark instead of a letter.
 */
const logos: Record<string, string> = {
  "amazon-bedrock": bedrock,
  "ant-ling": ling,
  anthropic,
  azure,
  baseten,
  cerebras,
  "cloudflare-ai-gateway": cloudflare,
  "cloudflare-workers-ai": cloudflare,
  deepseek,
  fireworks,
  "github-copilot": githubcopilot,
  google,
  "google-vertex": vertexai,
  groq,
  huggingface,
  "kimi-coding": kimi,
  meta,
  minimax,
  "minimax-cn": minimax,
  mistral,
  moonshotai: moonshot,
  "moonshotai-cn": moonshot,
  nvidia,
  openai,
  "openai-codex": codex,
  opencode,
  "opencode-go": opencode,
  openrouter,
  "qwen-token-plan": qwen,
  "qwen-token-plan-cn": qwen,
  "qwen-token-plan-individual": qwen,
  "qwen-token-plan-individual-cn": qwen,
  together,
  typesafe: typesafeai,
  "vercel-ai-gateway": vercel,
  xai,
  xiaomi: xiaomimimo,
  "xiaomi-token-plan-ams": xiaomimimo,
  "xiaomi-token-plan-cn": xiaomimimo,
  "xiaomi-token-plan-sgp": xiaomimimo,
  zai,
  "zai-coding-cn": zai,
};

export function ProviderLogo({ providerId }: { providerId: string }) {
  const logo = logos[providerId];
  if (logo)
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white shadow-xs">
        <img src={logo} alt="" className="size-5 object-contain" />
      </span>
    );
  const Icon = providerId === "radius" ? Orbit : Bot;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white shadow-xs">
      <Icon className="size-5 text-muted-foreground" aria-hidden />
    </span>
  );
}
