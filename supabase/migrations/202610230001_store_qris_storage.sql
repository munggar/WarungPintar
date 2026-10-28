insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-qris', 'store-qris', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = 1048576,
    allowed_mime_types = array['image/png', 'image/jpeg'];

drop policy if exists "Store members can read store QRIS" on storage.objects;
create policy "Store members can read store QRIS" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'store-qris'
    and storage.filename(name) = 'qris-image'
    and public.is_store_member(
      case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid else null end
    )
  );

drop policy if exists "Store owners can upload store QRIS" on storage.objects;
create policy "Store owners can upload store QRIS" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'store-qris'
    and storage.filename(name) = 'qris-image'
    and public.is_store_owner(
      case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid else null end
    )
  );

drop policy if exists "Store owners can replace store QRIS" on storage.objects;
create policy "Store owners can replace store QRIS" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'store-qris'
    and storage.filename(name) = 'qris-image'
    and public.is_store_owner(
      case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid else null end
    )
  )
  with check (
    bucket_id = 'store-qris'
    and storage.filename(name) = 'qris-image'
    and public.is_store_owner(
      case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid else null end
    )
  );

drop policy if exists "Store owners can delete store QRIS" on storage.objects;
create policy "Store owners can delete store QRIS" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'store-qris'
    and storage.filename(name) = 'qris-image'
    and public.is_store_owner(
      case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid else null end
    )
  );
