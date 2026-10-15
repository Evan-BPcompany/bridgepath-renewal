import type { Knex } from 'knex';

// Aligns estimates.status with the ten statuses of PRD FR-5.5.
//
//   kept            new_receipt, under_review, quoted, accepted, on_hold, completed, cancelled
//   new             info_requested, factory_checking
//   renamed         negotiating -> customer_review
//   merged          rejected    -> cancelled
//                   archived    -> completed
//
// Only estimates.status is migrated. status_history is an audit trail and is NOT touched, in
// either direction: its old_status/new_status keep the values they were written with (so an old
// entry may name rejected, archived or negotiating, and "completed -> archived" stays what it
// was). The admin API marks such entries with retired_status.
//
// The rows that change are saved in estimate_status_backup, so that rolling back can give them
// their original status back exactly.

const NEW_STATUSES = [
  'new_receipt',
  'under_review',
  'info_requested',
  'factory_checking',
  'quoted',
  'customer_review',
  'accepted',
  'on_hold',
  'completed',
  'cancelled'
];

const OLD_STATUSES = [
  'new_receipt',
  'under_review',
  'quoted',
  'negotiating',
  'accepted',
  'completed',
  'cancelled',
  'rejected',
  'on_hold',
  'archived'
];

const list = (values: string[]): string => values.map(value => `'${value}'`).join(', ');

// The CHECK on estimates.status was created without a name in migration 001, so PostgreSQL
// named it. Look it up by what it checks instead of assuming the generated name.
async function statusConstraintName(knex: Knex, mentions: string): Promise<string> {
  const found = await knex.raw(
    `SELECT conname
     FROM pg_constraint
     WHERE conrelid = 'estimates'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%${mentions}%'`
  );

  if (found.rows.length !== 1) {
    throw new Error(
      `Expected exactly one CHECK constraint on estimates.status, found ${found.rows.length}.`
    );
  }
  return found.rows[0].conname as string;
}

export async function up(knex: Knex): Promise<void> {
  // The strongest lock first: it avoids upgrading a weaker lock (and a deadlock with a reader)
  // when the constraint is dropped, and keeps status changes out until this commits.
  await knex.raw('LOCK TABLE estimates IN ACCESS EXCLUSIVE MODE');

  await knex.raw(`
    CREATE TABLE estimate_status_backup (
      estimate_id UUID PRIMARY KEY REFERENCES estimates(id) ON DELETE CASCADE,
      original_status VARCHAR(50) NOT NULL,
      migrated_status VARCHAR(50) NOT NULL,
      backed_up_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await knex.raw(`
    INSERT INTO estimate_status_backup (estimate_id, original_status, migrated_status)
    SELECT id,
           status,
           CASE status
             WHEN 'rejected' THEN 'cancelled'
             WHEN 'archived' THEN 'completed'
             WHEN 'negotiating' THEN 'customer_review'
           END
    FROM estimates
    WHERE status IN ('rejected', 'archived', 'negotiating')
  `);

  const oldConstraint = await statusConstraintName(knex, 'new_receipt');
  await knex.raw('ALTER TABLE estimates DROP CONSTRAINT ??', [oldConstraint]);

  // updated_at is left alone: this is not a change made by a user.
  await knex.raw(`
    UPDATE estimates
    SET status = CASE status
      WHEN 'rejected' THEN 'cancelled'
      WHEN 'archived' THEN 'completed'
      WHEN 'negotiating' THEN 'customer_review'
    END
    WHERE status IN ('rejected', 'archived', 'negotiating')
  `);

  await knex.raw(`
    ALTER TABLE estimates
      ADD CONSTRAINT estimates_status_check CHECK (status IN (${list(NEW_STATUSES)}))
  `);
}

// Rolling back must not lose anything. In this order, in one transaction (any failure rolls
// everything back, the dropped constraint included):
//   1. lock estimates;
//   2. refuse, before anything is changed, while an estimate is in info_requested or
//      factory_checking: the previous status set has no equivalent for them;
//   3. drop the new CHECK (it forbids the old statuses, so it has to go before they are restored);
//   4. give the rows saved by up() their original status, but only if they still have the status
//      up() gave them (a row that changed since is left as it is);
//   5. rename the remaining customer_review rows (also those created after up()) back to
//      negotiating, the same status under its old name;
//   6. check that every status is now one of the old ten, otherwise fail;
//   7. create the original CHECK again (its statuses are those of migration 001);
//   8. drop the backup table.
// status_history is not touched.
export async function down(knex: Knex): Promise<void> {
  await knex.raw('LOCK TABLE estimates IN ACCESS EXCLUSIVE MODE');

  const blocking = await knex.raw(`
    SELECT count(*)::int AS rows
    FROM estimates
    WHERE status IN ('info_requested', 'factory_checking')
  `);
  const rows: number = blocking.rows[0].rows;

  if (rows > 0) {
    throw new Error(
      `Refusing to roll back migration 013: ${rows} estimate(s) are in info_requested or ` +
        'factory_checking, which the previous status set does not have. Move them to another ' +
        'status first, then roll back again.'
    );
  }

  const newConstraint = await statusConstraintName(knex, 'customer_review');
  await knex.raw('ALTER TABLE estimates DROP CONSTRAINT ??', [newConstraint]);

  await knex.raw(`
    UPDATE estimates e
    SET status = b.original_status
    FROM estimate_status_backup b
    WHERE b.estimate_id = e.id
      AND e.status = b.migrated_status
  `);

  await knex.raw(`UPDATE estimates SET status = 'negotiating' WHERE status = 'customer_review'`);

  const outside = await knex.raw(`
    SELECT count(*)::int AS rows
    FROM estimates
    WHERE status NOT IN (${list(OLD_STATUSES)})
  `);
  if (outside.rows[0].rows > 0) {
    throw new Error(
      `Rolling back migration 013 would leave ${outside.rows[0].rows} estimate(s) with a status ` +
        'the previous status set does not allow; nothing was changed.'
    );
  }

  await knex.raw(`
    ALTER TABLE estimates
      ADD CONSTRAINT estimates_status_check CHECK (status IN (${list(OLD_STATUSES)}))
  `);

  await knex.raw('DROP TABLE estimate_status_backup');
}
