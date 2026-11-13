import { IdentitySection } from "./IdentitySection";
import { PublishAccountsSection } from "./PublishAccountsSection";

/** Publishing: the commit identity and the saved GitHub accounts a site can deploy with. */
export function PublishingSection() {
  return (
    <div className="flex flex-col gap-8">
      <IdentitySection />
      <div className="border-t" />
      <PublishAccountsSection />
    </div>
  );
}
