-- trigger_at is when the case entered the queue: the detector's trigger, a reappearance after
-- the 6 h trigger, or a request from the panel. It keeps the case's place while the model is
-- away (FR-028). started_at is when the last attempt began, to tell one cut off by a restart.
ALTER TABLE candidates ADD COLUMN started_at INTEGER;
-- Until now trigger_at was rewritten at each attempt, so for the cases past `pending` it is the start.
UPDATE candidates SET started_at = trigger_at WHERE state NOT IN ('detected', 'discarded', 'pending');
