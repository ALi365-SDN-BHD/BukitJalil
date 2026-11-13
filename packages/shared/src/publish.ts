import { z } from "zod";

/** Publishing accounts the user saves once and picks for a site's deployment. */
export const publishPlatforms = ["github"] as const;
export type PublishPlatform = (typeof publishPlatforms)[number];

const Name = z.string().trim().min(1).max(100);
const Token = z
  .string()
  .trim()
  .max(4096)
  .refine((s) => !/[\s\p{Cc}]/u.test(s), "must not contain spaces or control characters");

export const PublishAccountRequest = z
  .object({
    name: Name,
    platform: z.enum(publishPlatforms),
    /** Omitted on edit keeps the stored token. */
    token: Token.optional(),
  })
  .strict();
export type PublishAccountRequest = z.infer<typeof PublishAccountRequest>;

export interface PublishAccount {
  id: string;
  name: string;
  platform: PublishPlatform;
  createdAt: string;
  /** The token itself never leaves the server. */
  hasToken: boolean;
  tokenLast4: string | null;
}
