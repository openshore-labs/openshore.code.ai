-- A stand-in for pg_cron (see pg_cron.control): the job table and the two
-- calls the migrations make, with pg_cron's own rule that a role unschedules
-- only its own jobs by name.
create table cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  nodename text not null default 'localhost',
  nodeport int not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text
);

create function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql
as $$
  delete from cron.job where jobname = job_name and username = current_user;
  insert into cron.job (schedule, command, jobname)
  values (schedule, command, job_name)
  returning jobid;
$$;

create function cron.unschedule(job_name text)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = job_name and username = current_user;
  if not found then
    raise exception 'could not find valid entry for job ''%''', job_name;
  end if;
  return true;
end;
$$;
