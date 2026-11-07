-- A reply is announced to the person it answers at most once: set to 1 by a compare-and-set when the notice is decided.
ALTER TABLE comments ADD COLUMN announced INTEGER NOT NULL DEFAULT 0;
