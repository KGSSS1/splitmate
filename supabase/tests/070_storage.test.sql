-- Receipts storage (SPEC §8): private bucket, objects at {expense_id}/{file},
-- readable by whoever can see the expense, writable by whoever can edit it.
begin;
select plan(13);

select tests.create_user(name) from unnest(array['alice', 'bob', 'dave']) as name;
select tests.make_group('Receipts', 'alice', array['bob']);
select tests.add_equal_expense('lunch', tests.group_id('Receipts'), 'alice', 1000, array['alice', 'bob']);
reset role;

select is((select public from storage.buckets where id = 'receipts'), false, 'the receipts bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'receipts'),
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
          'only JPEG, PNG, WebP and PDF uploads are allowed');

-- ---------------------------------------------------------------- upload
select tests.authenticate_as('alice');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', %L, %L) $$,
         tests.expense_id('lunch') || '/receipt.jpg', tests.uid('alice')),
  'a member uploads a receipt under the expense''s folder');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', 'not-an-expense/receipt.jpg', %L) $$,
         tests.uid('alice')),
  '42501', 'new row violates row-level security policy for table "objects"', 'objects outside an expense folder are rejected');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', %L, %L) $$,
         tests.expense_id('lunch') || '/forged.jpg', tests.uid('bob')),
  '42501', 'new row violates row-level security policy for table "objects"', 'an upload must be owned by the uploader');

select tests.authenticate_as('dave');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('receipts', %L, %L) $$,
         tests.expense_id('lunch') || '/intruder.jpg', tests.uid('dave')),
  '42501', 'new row violates row-level security policy for table "objects"', 'a non-member cannot upload to someone else''s expense');

-- ---------------------------------------------------------------- read
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
          'a non-member cannot see the receipt');
select tests.authenticate_as('bob');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 1,
          'another member can see the receipt');
select tests.authenticate_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
          'an anonymous user cannot see the receipt');

-- ---------------------------------------------------------------- attachment metadata
select tests.authenticate_as('alice');
select lives_ok(
  format($$ insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes) values (%L, %L, %L, 'image/jpeg', 2048) $$,
         tests.expense_id('lunch'), tests.uid('alice'), tests.expense_id('lunch') || '/receipt.jpg'),
  'the uploader records the attachment');
insert into storage.objects (bucket_id, name, owner_id)
values ('receipts', tests.expense_id('lunch') || '/anim.gif', tests.uid('alice'));
select throws_ok(
  format($$ insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes) values (%L, %L, %L, 'image/gif', 2048) $$,
         tests.expense_id('lunch'), tests.uid('alice'), tests.expense_id('lunch') || '/anim.gif'),
  '23514', 'new row for relation "attachments" violates check constraint "attachments_mime_type_check"', 'attachment types are restricted');
select tests.allow_storage_delete();
delete from storage.objects where bucket_id = 'receipts' and name like '%/anim.gif';

-- ---------------------------------------------------------------- delete (as the Storage API would)
select tests.authenticate_as('bob');
select tests.allow_storage_delete();
with d as (delete from storage.objects where bucket_id = 'receipts' returning 1)
select is(count(*)::int, 0, 'a member cannot delete someone else''s receipt') from d;
select tests.authenticate_as('alice');
select tests.allow_storage_delete();
with d as (delete from storage.objects where bucket_id = 'receipts' returning 1)
select is(count(*)::int, 1, 'the uploader can delete their own receipt') from d;

reset role;
select * from finish();
rollback;
