import * as i18n from '@runhq/cockpit-ui/i18n';
import { Search, Sparkles, Star } from 'lucide-react';
import { truncate } from './model';

interface EmptyStateProps {
  hasQuery: boolean;
  favoritesOnly: boolean;
  query: string;
}

export function EmptyState({ hasQuery, favoritesOnly, query }: EmptyStateProps) {
  i18n.useLocale();
  if (hasQuery) {
    return (
      <div className="text-fg-dim flex flex-col items-center gap-2 px-4 py-8 text-center text-[11px]">
        <Search className="text-fg-dim/60 h-4 w-4" />
        <p>{i18n.rich('No matches for "{value1}".', { value1: truncate(query, 30) })}</p>
        <p className="text-fg-dim/70">{i18n.t('Try a shorter or different query.')}</p>
      </div>
    );
  }
  if (favoritesOnly) {
    return (
      <div className="text-fg-dim flex flex-col items-center gap-2 px-4 py-8 text-center text-[11px]">
        <Star className="text-fg-dim/60 h-4 w-4" />
        <p>{i18n.t('No favorites yet.')}</p>
        <p className="text-fg-dim/70">{i18n.t('Star a conversation to keep it close at hand.')}</p>
      </div>
    );
  }
  return (
    <div className="text-fg-dim flex flex-col items-center gap-2 px-4 py-8 text-center text-[11px]">
      <Sparkles className="text-accent/60 h-4 w-4" />
      <p>{i18n.t('No conversations yet.')}</p>
      <p className="text-fg-dim/70">{i18n.t('Send a message in the chat panel to start one.')}</p>
    </div>
  );
}
