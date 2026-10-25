-- Receipts storage (SPEC §8): private bucket, objects at {expense_id}/{random id}.{ext},
-- readable by whoever can see the expense once attached, writable by whoever can edit it.
-- Review M9 L2: only app-shaped names, others see a file only after it is attached
-- (content-checked), and an attached file can't be deleted and swapped.
begin;
select plan(17);

select tests.create_user(name) from unnest(array['alice', 'bob', 'dave']) as name;
select tests.make_group('Receipts', 'alice', array['bob']);
select tests.add_equal_expense('lunch', tests.group_id('Receipts'), 'alice', 1000, array['alice', 'bob']);
reset role;

create temp table receipt_names as
  select tests.expense_id('lunch') || '/' || tests.uid('receipt') || '.jpg' as good,
         tests.expense_id('lunch') || '/' || tests.uid('forged') || '.jpg' as forged,
         tests.expense_id('lunch') || '/' || tests.uid('intruder') || '.jpg' as intruder;
grant select on receipt_names to authenticated;

select is((select public from storage.buckets where id = 'receipts'), false, 'the receipts bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'receipts'),
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
          'only JPEG, PNG, WebP and PDF uploads are allowed');

-- ---------------------------------------------------------------- upload
select tests.authenticate_as('alice');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', %L, %L) $$,
         (select good from receipt_names), tests.uid('alice')),
  'a member uploads a receipt under the expense''s folder');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', 'not-an-expense/receipt.jpg', %L) $$,
         tests.uid('alice')),
  '42501', 'new row violates row-level security policy for table "objects"', 'objects outside an expense folder are rejected');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', %L, %L) $$,
         tests.expense_id('lunch') || '/page.html', tests.uid('alice')),
  '42501', 'new row violates row-level security policy for table "objects"', 'names the app would not choose are rejected');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', %L, %L) $$,
         (select forged from receipt_names), tests.uid('bob')),
  '42501', 'new row violates row-level security policy for table "objects"', 'an upload must be owned by the uploader');

select tests.authenticate_as('dave');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', %L, %L) $$,
         (select intruder from receipt_names), tests.uid('dave')),
  '42501', 'new row violates row-level security policy for table "objects"', 'a non-member cannot upload to someone else''s expense');

-- ---------------------------------------------------------------- read before attaching
select tests.authenticate_as('alice');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 1,
          'the uploader can read her pending upload (for the content check)');
select tests.authenticate_as('bob');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
          'other members can''t see it until it is attached');

-- ---------------------------------------------------------------- attachment metadata
select tests.authenticate_as('alice');
select lives_ok(
  format($$ insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes) values (%L, %L, %L, 'image/jpeg', 2048) $$,
         tests.expense_id('lunch'), tests.uid('alice'), (select good from receipt_names)),
  'the uploader records the attachment');
insert into storage.objects (bucket_id, name, owner_id)
values ('receipts', tests.expense_id('lunch') || '/' || tests.uid('anim') || '.png', tests.uid('alice'));
select throws_ok(
  format($$ insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes) values (%L, %L, %L, 'image/gif', 2048) $$,
         tests.expense_id('lunch'), tests.uid('alice'), tests.expense_id('lunch') || '/' || tests.uid('anim') || '.png'),
  '23514', 'new row for relation "attachments" violates check constraint "attachments_mime_type_check"', 'attachment types are restricted');
select tests.allow_storage_delete();
delete from storage.objects where bucket_id = 'receipts' and name = tests.expense_id('lunch') || '/' || tests.uid('anim') || '.png';

-- ---------------------------------------------------------------- read after attaching
select tests.authenticate_as('dave');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
          'a non-member cannot see the receipt');
select tests.authenticate_as('bob');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 1,
          'another member can see the attached receipt');
select tests.authenticate_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
          'an anonymous user cannot see the receipt');

-- ---------------------------------------------------------------- delete (as the Storage API would)
select tests.authenticate_as('bob');
select tests.allow_storage_delete();
with d as (delete from storage.objects where bucket_id = 'receipts' returning 1)
select is(count(*)::int, 0, 'a member cannot delete someone else''s receipt') from d;
select tests.authenticate_as('alice');
select tests.allow_storage_delete();
with d as (delete from storage.objects where bucket_id = 'receipts' returning 1)
select is(count(*)::int, 0, 'nor can the uploader while it is attached (it could be swapped)') from d;
delete from public.attachments where storage_path = (select good from receipt_names);
select tests.allow_storage_delete();
with d as (delete from storage.objects where bucket_id = 'receipts' returning 1)
select is(count(*)::int, 1, 'once the attachment row is removed, the uploader deletes the file') from d;

reset role;
select * from finish();
rollback;
