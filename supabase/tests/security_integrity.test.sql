begin;

select plan(55);

select has_table('public', 'owner_registration_invites', 'owner invite table exists');
select has_table('public', 'password_reset_attempts', 'persistent reset limiter table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.owner_registration_invites'::regclass),
  'owner invite table has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.password_reset_attempts'::regclass),
  'reset limiter table has RLS enabled'
);
select ok(not has_table_privilege('anon', 'public.owner_registration_invites', 'SELECT'), 'anon cannot read owner invites');
select ok(not has_table_privilege('authenticated', 'public.owner_registration_invites', 'SELECT'), 'authenticated cannot read owner invites');
select ok(not has_table_privilege('anon', 'public.password_reset_attempts', 'SELECT'), 'anon cannot read reset attempts');
select ok(not has_table_privilege('authenticated', 'public.password_reset_attempts', 'SELECT'), 'authenticated cannot read reset attempts');
select ok(has_function_privilege('service_role', 'public.consume_password_reset_attempt(text)', 'EXECUTE'), 'service role can use reset limiter');
select ok(not has_function_privilege('anon', 'public.consume_password_reset_attempt(text)', 'EXECUTE'), 'anon cannot use reset limiter');
select ok(not has_function_privilege('authenticated', 'public.resolve_password_reset_target(text)', 'EXECUTE'), 'authenticated cannot resolve reset accounts');
select is(
  (select count(*)::integer from public.resolve_password_reset_target('missing-user@invalid.test')),
  0,
  'unknown reset email resolves to no account rows'
);

create temporary table test_security_context (
  invite_token text,
  reservation_id uuid,
  store_a uuid,
  store_b uuid,
  owner_a uuid,
  owner_b uuid,
  assistant_a uuid,
  loan_id uuid,
  loan_id_2 uuid,
  compensation_loan_id uuid,
  compensation_payment_loan_id uuid,
  customer_id uuid,
  customer_id_2 uuid,
  payment_id uuid,
  payment_id_2 uuid,
  payment_id_3 uuid,
  payment_id_4 uuid
) on commit drop;

insert into test_security_context (
  invite_token, owner_a, owner_b, assistant_a,
  loan_id, loan_id_2, compensation_loan_id, compensation_payment_loan_id,
  customer_id, customer_id_2, payment_id, payment_id_2, payment_id_3, payment_id_4
)
values (
  public.create_owner_registration_invite('kasbon-owner-a@invalid.test'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '22222222-3333-4444-8555-666666666666',
  '33333333-4444-4555-8666-777777777777',
  '44444444-5555-4666-8777-888888888888',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '55555555-6666-4777-8888-999999999999',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '11111111-2222-4333-8444-555555555555',
  '66666666-7777-4888-8999-aaaaaaaaaaaa',
  '77777777-8888-4999-8aaa-bbbbbbbbbbbb'
);
select ok((select invite_token ~ '^[0-9a-f]{64}$' from test_security_context), 'admin invitation is 256-bit hex token');
select is(
  public.reserve_owner_registration_invite(
    (select invite_token from test_security_context),
    'someone-else@invalid.test'
  ),
  null::uuid,
  'owner invite is bound to the approved email'
);
update test_security_context
set reservation_id = public.reserve_owner_registration_invite(invite_token, 'KASBON-OWNER-A@invalid.test');
select ok((select reservation_id is not null from test_security_context), 'matching owner invite can be reserved');
select is(
  public.reserve_owner_registration_invite(
    (select invite_token from test_security_context),
    'kasbon-owner-a@invalid.test'
  ),
  null::uuid,
  'active reservation prevents reuse'
);
select ok(
  public.release_owner_registration_invite((select reservation_id from test_security_context)),
  'failed registration can release its reservation'
);
update test_security_context
set reservation_id = public.reserve_owner_registration_invite(invite_token, 'kasbon-owner-a@invalid.test');
select ok((select reservation_id is not null from test_security_context), 'released owner invite can be retried');

select ok(public.consume_password_reset_attempt(repeat('a', 64)), 'first reset attempt is allowed');
do $$
declare
  attempt_number integer;
begin
  for attempt_number in 2..10 loop
    perform public.consume_password_reset_attempt(repeat('a', 64));
  end loop;
end;
$$;
select ok(not public.consume_password_reset_attempt(repeat('a', 64)), 'eleventh reset attempt is blocked');
select ok(not public.consume_password_reset_attempt(repeat('a', 64)), 'further reset attempts remain blocked');
update public.password_reset_attempts
set window_started_at = now() - interval '2 hours'
where email_hash = repeat('a', 64);
select ok(public.consume_password_reset_attempt(repeat('a', 64)), 'reset attempts are allowed after the window expires');

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'kasbon-owner-a@invalid.test', '', now(), '{"store_name":"Audit A"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'kasbon-owner-b@invalid.test', '', now(), '{"store_name":"Audit B"}');

update test_security_context context
set store_a = member.store_id
from public.store_members member
where member.user_id = context.owner_a;
update test_security_context context
set store_b = member.store_id
from public.store_members member
where member.user_id = context.owner_b;

select ok(
  public.complete_owner_registration_invite(context.reservation_id, context.owner_a),
  'owner registration completes and redeems the reserved invite'
)
from test_security_context context;
select is(
  public.reserve_owner_registration_invite(
    (select invite_token from test_security_context),
    'kasbon-owner-a@invalid.test'
  ),
  null::uuid,
  'redeemed owner invite cannot be used again'
);

insert into public.store_invites (store_id, email, invited_by, expires_at)
select store_a, 'kasbon-assistant-a@invalid.test', owner_a, now() + interval '1 hour'
from test_security_context;
insert into auth.users (id, email, encrypted_password, email_confirmed_at)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'kasbon-assistant-a@invalid.test', '', now());

insert into public.store_data (
  store_id, ciphertext, iv, recovery_salt, recovery_iv, recovery_wrapped_key, updated_by
)
select store_a, 'ciphertext', 'iv', 'AAAAAAAAAAAAAAAAAAAAAA==', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', owner_a
from test_security_context;
select is(
  (select count(*)::integer from public.resolve_password_reset_target('kasbon-owner-a@invalid.test')),
  1,
  'password reset lookup returns the invited owner and recovery envelope'
);
select is(
  (select count(*)::integer from public.resolve_password_reset_target('kasbon-assistant-a@invalid.test')),
  1,
  'password reset lookup resolves an assistant only through its current store membership'
);
select ok((select store_a is not null and store_b is not null and store_a <> store_b from test_security_context), 'two owners receive distinct stores');
select is(
  (select count(*)::integer from public.store_members member, test_security_context context
   where member.store_id = context.store_a and member.user_id = context.assistant_a and member.role = 'assistant'),
  1,
  'assistant is a member of the invited store'
);
select ok(
  not has_function_privilege('authenticated', 'public.smart_kasbon_transaction(text,uuid,uuid,jsonb)', 'EXECUTE'),
  'authenticated owners and assistants cannot invoke service-only transaction RPC'
);
select ok(not has_table_privilege('anon', 'public.stores', 'SELECT'), 'unauthenticated users cannot query stores');

create function pg_temp.visible_store_count()
returns integer
language sql
stable
as $$
  select count(*)::integer from public.stores;
$$;
create temporary table test_rls_visibility (
  owner_a_stores integer,
  owner_a_member_a boolean,
  owner_a_member_b boolean,
  owner_a_owner_a boolean,
  owner_b_stores integer,
  owner_b_owner_b boolean,
  assistant_a_stores integer,
  assistant_a_member_a boolean,
  assistant_a_member_b boolean,
  assistant_a_owner_a boolean
) on commit drop;
grant insert on test_rls_visibility to authenticated;
grant select on test_security_context to authenticated;
do $$
declare
  temp_schema text;
begin
  select nspname into temp_schema
  from pg_namespace
  where oid = pg_my_temp_schema();
  execute format('grant usage on schema %I to authenticated', temp_schema);
end;
$$;
grant execute on function pg_temp.visible_store_count() to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
insert into test_rls_visibility (owner_a_stores, owner_a_member_a, owner_a_member_b, owner_a_owner_a)
select
  pg_temp.visible_store_count(),
  public.is_store_member(context.store_a),
  public.is_store_member(context.store_b),
  public.is_store_owner(context.store_a)
from test_security_context context;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
insert into test_rls_visibility (owner_b_stores, owner_b_owner_b)
select pg_temp.visible_store_count(), public.is_store_owner(context.store_b)
from test_security_context context;
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
insert into test_rls_visibility (assistant_a_stores, assistant_a_member_a, assistant_a_member_b, assistant_a_owner_a)
select
  pg_temp.visible_store_count(),
  public.is_store_member(context.store_a),
  public.is_store_member(context.store_b),
  public.is_store_owner(context.store_a)
from test_security_context context;
reset role;

select is((select owner_a_stores from test_rls_visibility where owner_a_stores is not null), 1, 'owner A sees only store A');
select ok((select owner_a_member_a and not owner_a_member_b and owner_a_owner_a from test_rls_visibility where owner_a_stores is not null), 'owner A membership and owner role are scoped to store A');
select is((select owner_b_stores from test_rls_visibility where owner_b_stores is not null), 1, 'owner B sees only store B');
select ok((select owner_b_owner_b from test_rls_visibility where owner_b_stores is not null), 'owner B is owner of store B');
select is((select assistant_a_stores from test_rls_visibility where assistant_a_stores is not null), 1, 'assistant sees only its invited store');
select ok((select assistant_a_member_a and not assistant_a_member_b and not assistant_a_owner_a from test_rls_visibility where assistant_a_stores is not null), 'assistant cannot cross stores or act as owner');

select public.smart_kasbon_transaction('bootstrap', context.store_a, context.owner_a, '{"loans":[],"payments":[],"finalize":true}'::jsonb)
from test_security_context context;
select public.smart_kasbon_transaction('bootstrap', context.store_b, context.owner_b, '{"loans":[],"payments":[],"finalize":true}'::jsonb)
from test_security_context context;
select public.smart_kasbon_transaction(
  'set_policy',
  context.store_a,
  context.owner_a,
  jsonb_build_object(
    'cash_available', 1000000, 'working_capital', 1000000, 'liabilities', 0,
    'reserve_cash', 0, 'max_per_customer', 1000000,
    'max_active_customers', 3, 'max_total_receivable', 1000000,
    'financial_snapshot', jsonb_build_object(
      'generated_at', now(), 'has_sales_30', true, 'revenue_30', 100000,
      'revenue_previous_30', 90000, 'net_profit_30', 20000,
      'net_profit_previous_30', 15000, 'cash_flow_30', 1000
    )
  )
)
from test_security_context context;
select public.smart_kasbon_transaction(
  'set_policy',
  context.store_b,
  context.owner_b,
  jsonb_build_object(
    'cash_available', 1000000, 'working_capital', 1000000, 'liabilities', 0,
    'reserve_cash', 0, 'max_per_customer', 1000000,
    'max_active_customers', 3, 'max_total_receivable', 1000000,
    'financial_snapshot', jsonb_build_object(
      'generated_at', now(), 'has_sales_30', true, 'revenue_30', 100000,
      'revenue_previous_30', 90000, 'net_profit_30', 20000,
      'net_profit_previous_30', 15000, 'cash_flow_30', 1000
    )
  )
)
from test_security_context context;

select ok(
  (public.smart_kasbon_transaction(
    'issue', context.store_a, context.owner_a,
    jsonb_build_object('loan_id', context.loan_id, 'customer_id', context.customer_id,
      'amount', 400000, 'due_date', (now() at time zone 'Asia/Jakarta')::date + 1)
  )->>'approved')::boolean,
  'owner transaction issues a loan within the rule-based limit'
)
from test_security_context context;
select ok(
  (public.smart_kasbon_transaction(
    'issue', context.store_a, context.owner_a,
    jsonb_build_object('loan_id', context.loan_id, 'customer_id', context.customer_id,
      'amount', 400000, 'due_date', (now() at time zone 'Asia/Jakarta')::date + 1)
  )->>'approved')::boolean,
  'repeating the same issue request is idempotent'
)
from test_security_context context;
select is(
  (select count(*)::integer from public.smart_kasbon_loans loan, test_security_context context
   where loan.store_id = context.store_a and loan.id = context.loan_id),
  1,
  'repeated issue ID does not duplicate the loan'
);
select ok(
  (public.smart_kasbon_transaction(
    'payment', context.store_a, context.owner_a,
    jsonb_build_object('payment_id', context.payment_id, 'loan_id', context.loan_id, 'amount', 100000)
  )->>'paid')::boolean,
  'partial payment succeeds'
)
from test_security_context context;
select ok(
  (public.smart_kasbon_transaction(
    'payment', context.store_a, context.owner_a,
    jsonb_build_object('payment_id', context.payment_id, 'loan_id', context.loan_id, 'amount', 100000)
  )->>'idempotent')::boolean,
  'repeated payment ID is idempotent'
)
from test_security_context context;
select ok(
  (public.smart_kasbon_transaction(
    'issue', context.store_a, context.owner_a,
    jsonb_build_object('loan_id', context.loan_id_2, 'customer_id', context.customer_id_2,
      'amount', 300000, 'due_date', (now() at time zone 'Asia/Jakarta')::date + 1)
  )->>'approved')::boolean,
  'new customer issue uses total limit without subtracting current receivable twice'
)
from test_security_context context;
select is(
  (select coalesce(sum(loan.amount - loan.paid_amount), 0)::bigint
   from public.smart_kasbon_loans loan, test_security_context context
   where loan.store_id = context.store_a and loan.status = 'active'),
  600000::bigint,
  'active receivable remains within the absolute total limit'
);
select ok(
  (public.smart_kasbon_transaction(
    'payment', context.store_a, context.owner_a,
    jsonb_build_object('payment_id', context.payment_id_2, 'loan_id', context.loan_id, 'amount', 300000)
  )->>'settled')::boolean,
  'final payment settles the loan'
)
from test_security_context context;
select ok(
  (public.smart_kasbon_transaction(
    'payment', context.store_a, context.owner_a,
    jsonb_build_object('payment_id', context.payment_id_3, 'loan_id', context.loan_id_2, 'amount', 300000)
  )->>'settled')::boolean,
  'second customer loan can be repaid independently'
)
from test_security_context context;
select is(
  (select loan.paid_amount from public.smart_kasbon_loans loan, test_security_context context
   where loan.store_id = context.store_a and loan.id = context.loan_id),
  400000::bigint,
  'partial and final payments reconcile to the loan total'
);
select ok(
  (select loan.settled_at is not null from public.smart_kasbon_loans loan, test_security_context context
   where loan.store_id = context.store_a and loan.id = context.loan_id),
  'settled loan has server-side settlement time'
);
select throws_ok(
  format(
    'select public.smart_kasbon_transaction(%L, %L, %L, %L::jsonb)',
    'payment',
    (select store_b::text from test_security_context),
    (select owner_b::text from test_security_context),
    jsonb_build_object(
      'payment_id', (select payment_id_2 from test_security_context),
      'loan_id', (select loan_id from test_security_context),
      'amount', 1
    )::text
  ),
  'P0001',
  'Jumlah pembayaran melebihi saldo atau kasbon tidak ditemukan.',
  'a different store cannot post a payment against another store loan'
);
select ok(
  (public.smart_kasbon_transaction(
    'issue', context.store_a, context.owner_a,
    jsonb_build_object('loan_id', context.compensation_loan_id, 'customer_id', context.customer_id,
      'amount', 1000, 'due_date', (now() at time zone 'Asia/Jakarta')::date + 1)
  )->>'approved')::boolean,
  'compensation test loan can be issued'
)
from test_security_context context;
select ok(
  (public.smart_kasbon_transaction(
    'void_loan', context.store_a, context.owner_a,
    jsonb_build_object('loan_id', context.compensation_loan_id)
  )->>'voided')::boolean,
  'failed local loan save can be compensated'
)
from test_security_context context;
select is(
  (select loan.status from public.smart_kasbon_loans loan, test_security_context context
   where loan.store_id = context.store_a and loan.id = context.compensation_loan_id),
  'void',
  'loan compensation closes the server loan'
);
select ok(
  (public.smart_kasbon_transaction(
    'issue', context.store_a, context.owner_a,
    jsonb_build_object('loan_id', context.compensation_payment_loan_id, 'customer_id', context.customer_id,
      'amount', 1000, 'due_date', (now() at time zone 'Asia/Jakarta')::date + 1)
  )->>'approved')::boolean,
  'payment compensation test loan can be issued'
)
from test_security_context context;
select ok(
  (public.smart_kasbon_transaction(
    'payment', context.store_a, context.owner_a,
    jsonb_build_object('payment_id', context.payment_id_4, 'loan_id', context.compensation_payment_loan_id, 'amount', 400)
  )->>'paid')::boolean,
  'payment compensation test records a partial payment'
)
from test_security_context context;
select ok(
  (public.smart_kasbon_transaction(
    'void_payment', context.store_a, context.owner_a,
    jsonb_build_object('payment_id', context.payment_id_4)
  )->>'voided')::boolean,
  'failed local payment save can be compensated'
)
from test_security_context context;
select is(
  (select loan.paid_amount from public.smart_kasbon_loans loan, test_security_context context
   where loan.store_id = context.store_a and loan.id = context.compensation_payment_loan_id),
  0::bigint,
  'payment compensation restores the loan balance'
);

select * from finish();
rollback;
