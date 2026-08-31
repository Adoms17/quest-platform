begin;

select plan(1);

select hasnt_table(
  'public',
  'attempts',
  'legacy participant-written attempts table is removed'
);

select * from finish();

rollback;
