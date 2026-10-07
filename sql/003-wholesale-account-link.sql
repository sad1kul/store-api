ALTER TABLE wholesale_applications
  ADD COLUMN user_id INT UNSIGNED NULL AFTER id,
  ADD INDEX idx_wholesale_user (user_id),
  ADD CONSTRAINT fk_wholesale_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE wholesale_applications AS application
JOIN users AS account ON LOWER(account.email) = LOWER(application.email)
SET application.user_id = account.id
WHERE application.user_id IS NULL;
