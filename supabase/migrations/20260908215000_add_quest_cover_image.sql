-- Phase 5: optional participant-facing quest cover image.

alter table public.quests
  add column cover_image_url text;

alter table public.quests
  add constraint quests_cover_image_url_length_check
  check (cover_image_url is null or char_length(cover_image_url) <= 2048);

