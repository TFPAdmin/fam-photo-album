-- Fence account deletion against requests that were already in flight.
CREATE TRIGGER users_deletion_guard BEFORE UPDATE ON users
WHEN EXISTS(SELECT 1 FROM settings WHERE key='deleting:'||OLD.id)
BEGIN SELECT RAISE(ABORT,'Account deletion is in progress'); END;
--> statement-breakpoint
CREATE TRIGGER sessions_owner_guard BEFORE INSERT ON sessions
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND active=1)
OR EXISTS(SELECT 1 FROM settings WHERE key='deleting:'||NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER media_owner_guard BEFORE INSERT ON media
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner)
OR EXISTS(SELECT 1 FROM settings WHERE key='deleting:'||NEW.owner)
BEGIN SELECT RAISE(ABORT,'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER media_deletion_guard BEFORE UPDATE ON media
WHEN EXISTS(SELECT 1 FROM settings WHERE key='deleting:'||OLD.owner)
BEGIN SELECT RAISE(ABORT,'Account deletion is in progress'); END;
--> statement-breakpoint
CREATE TRIGGER albums_owner_guard BEFORE INSERT ON albums
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner)
OR EXISTS(SELECT 1 FROM settings WHERE key='deleting:'||NEW.owner)
BEGIN SELECT RAISE(ABORT,'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER parts_media_guard BEFORE INSERT ON parts
WHEN NOT EXISTS(SELECT 1 FROM media WHERE id=NEW.media)
OR EXISTS(SELECT 1 FROM media m JOIN settings s ON s.key='deleting:'||m.owner WHERE m.id=NEW.media)
BEGIN SELECT RAISE(ABORT,'Media is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER shares_account_guard BEFORE INSERT ON shares
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.recipient)
OR NOT EXISTS(SELECT 1 FROM media WHERE id=NEW.media)
OR EXISTS(SELECT 1 FROM settings WHERE key='deleting:'||NEW.recipient)
OR EXISTS(SELECT 1 FROM media m JOIN settings s ON s.key='deleting:'||m.owner WHERE m.id=NEW.media)
BEGIN SELECT RAISE(ABORT,'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_account_guard BEFORE INSERT ON settings
WHEN substr(NEW.key,1,9)='recovery:' AND (
 NOT EXISTS(SELECT 1 FROM users WHERE id=substr(NEW.key,10))
 OR EXISTS(SELECT 1 FROM settings WHERE key='deleting:'||substr(NEW.key,10)))
BEGIN SELECT RAISE(ABORT,'Account is unavailable'); END;
