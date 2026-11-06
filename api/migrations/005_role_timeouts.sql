-- Statement timeouts live on the role, not in connection startup parameters: Neon's pooled endpoint
-- (PgBouncer, transaction mode) can refuse a statement_timeout startup parameter, and a session SET
-- does not survive across pooled transactions. A role default applies to every new server session.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', current_user, '10s');
  EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', current_user, '30s');
END
$$;
