import type { MediaProblem } from "@bukitjalil/shared";
import { useI18n } from "@/i18n";

/**
 * Why Bukit failed, in its own words, and the hint for a missing media placeholder (plan 8.6). Shared by
 * the build report and the publish result.
 */
export function BukitFailure({ errors, media, testId }: { errors?: string[]; media?: MediaProblem; testId: string }) {
  const { m, t } = useI18n();
  if (!errors?.length && !media) return null;
  return (
    <div className="flex flex-col gap-2">
      {errors && errors.length > 0 && (
        <section role="alert" className="flex flex-col gap-1" data-testid={`${testId}-bukit-errors`}>
          <h3 className="font-medium text-destructive">{m.build.bukitErrors}</h3>
          {errors.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a static list
            <pre key={i} className="whitespace-pre-wrap break-words rounded-md bg-destructive/10 p-2 text-xs">
              {e}
            </pre>
          ))}
        </section>
      )}
      {media && (
        <section className="flex flex-col gap-1" data-testid={`${testId}-media-problem`}>
          <p>
            {t(media.failedDownloads > 0 ? m.build.media.title : m.build.media.titleUnknown, {
              count: media.failedDownloads,
              path: media.missing,
            })}
          </p>
          <ul className="list-disc pl-5">
            <li>{m.build.media.keep}</li>
            <li>{m.build.media.static}</li>
            <li>{m.build.media.ai}</li>
          </ul>
        </section>
      )}
    </div>
  );
}
