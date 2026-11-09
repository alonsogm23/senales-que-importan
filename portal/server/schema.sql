PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('family','cenit','cenepsi','personal','doctor')),
 password TEXT NOT NULL, salt TEXT NOT NULL, totp TEXT, last_totp INTEGER DEFAULT -1,
 active INTEGER NOT NULL DEFAULT 1, session_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account TEXT REFERENCES accounts(id), version INTEGER, expires INTEGER, csrf TEXT NOT NULL, mfa INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY, name TEXT NOT NULL, birth_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enrollments (patient TEXT REFERENCES patients(id), center TEXT CHECK(center IN ('CENIT','Cenepsi')), PRIMARY KEY(patient,center));
CREATE TABLE IF NOT EXISTS grants (
 id TEXT PRIMARY KEY, account TEXT REFERENCES accounts(id), patient TEXT REFERENCES patients(id),
 manage INTEGER NOT NULL, submit INTEGER NOT NULL, clinical INTEGER NOT NULL,
 verified_by TEXT NOT NULL, evidence TEXT NOT NULL, review_on TEXT, revoked_at TEXT,
 UNIQUE(account,patient)
);
CREATE TABLE IF NOT EXISTS requests (
 id TEXT PRIMARY KEY, patient TEXT NOT NULL REFERENCES patients(id), requester TEXT NOT NULL REFERENCES accounts(id),
 center TEXT CHECK(center IN ('CENIT','Cenepsi') OR center IS NULL), reason INTEGER NOT NULL CHECK(reason BETWEEN 0 AND 4),
 state TEXT NOT NULL, priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 3), rules_version TEXT NOT NULL,
 assigned TEXT REFERENCES accounts(id), accepted_by TEXT REFERENCES accounts(id), accepted_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, due_at TEXT, recorded_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, request TEXT NOT NULL REFERENCES requests(id), author TEXT REFERENCES accounts(id),
 kind TEXT NOT NULL CHECK(kind IN ('administrative','clinical')), body TEXT NOT NULL,
 center TEXT, created_at TEXT NOT NULL, audience TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, request TEXT REFERENCES requests(id), series TEXT NOT NULL, version INTEGER NOT NULL,
 uploader TEXT REFERENCES accounts(id), center TEXT, clinical INTEGER NOT NULL, filename TEXT NOT NULL,
 mime TEXT NOT NULL, content BLOB NOT NULL, audience TEXT NOT NULL, approved_by TEXT REFERENCES accounts(id),
 approved_at TEXT, created_at TEXT NOT NULL, UNIQUE(series,version)
);
CREATE TABLE IF NOT EXISTS tickets (hash TEXT PRIMARY KEY, document TEXT REFERENCES documents(id), session TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, request TEXT REFERENCES requests(id), account TEXT REFERENCES accounts(id),
 channel TEXT CHECK(channel IN ('internal','email-test','secondary-test')), event TEXT NOT NULL, status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT, delivered_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(request,account,channel,event)
);
CREATE TABLE IF NOT EXISTS preferences (account TEXT PRIMARY KEY REFERENCES accounts(id), priorities TEXT NOT NULL DEFAULT '[0,1,2,3]');
CREATE TABLE IF NOT EXISTS observations (request TEXT PRIMARY KEY REFERENCES requests(id), status TEXT NOT NULL, payload TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rule_versions (version TEXT PRIMARY KEY, config TEXT NOT NULL, created_at TEXT NOT NULL, author TEXT NOT NULL, change_reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
 target TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append_only'); END;
-- Actor is set only by the trusted server via AsyncLocalStorage, never a SQL/API parameter.
-- Private base tables are never exposed; SQLite has no external client or RLS roles.
CREATE VIEW IF NOT EXISTS active_grants AS
 SELECT * FROM grants WHERE revoked_at IS NULL AND (review_on IS NULL OR review_on > santiago_today());
CREATE VIEW IF NOT EXISTS visible_requests AS
 SELECT r.* FROM requests r JOIN accounts a ON a.id=current_actor() AND a.active=1
 WHERE a.role='doctor'
 OR (a.role='personal')
 OR (a.role='cenit' AND r.center='CENIT') OR (a.role='cenepsi' AND r.center='Cenepsi')
 OR (a.role='family' AND EXISTS(SELECT 1 FROM active_grants g WHERE g.patient=r.patient AND g.account=a.id AND (g.manage=1 OR (g.submit=1 AND r.requester=a.id))));
CREATE VIEW IF NOT EXISTS visible_messages AS
 SELECT m.* FROM messages m JOIN visible_requests r ON r.id=m.request JOIN accounts a ON a.id=current_actor()
 WHERE a.role='doctor'
 OR (m.kind='administrative' AND ((a.role IN ('cenit','cenepsi') AND m.center=r.center) OR a.role IN ('personal','family')))
 OR (a.role='family' AND m.kind='clinical' AND EXISTS (SELECT 1 FROM active_grants g WHERE g.account=a.id AND g.patient=r.patient AND g.clinical=1) AND EXISTS(SELECT 1 FROM json_each(m.audience) WHERE value=a.id))
 OR (a.role='family' AND m.author=a.id);
CREATE VIEW IF NOT EXISTS visible_documents AS
 SELECT d.* FROM documents d JOIN visible_requests r ON r.id=d.request JOIN accounts a ON a.id=current_actor()
 WHERE a.role='doctor'
 OR (a.role IN ('personal','cenit','cenepsi') AND d.clinical=0 AND (a.role='personal' OR d.center=r.center))
 OR (a.role='family' AND d.approved_by IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(d.audience) WHERE value=a.id)
 AND EXISTS(SELECT 1 FROM active_grants g WHERE g.patient=r.patient AND g.account=a.id AND ((d.clinical=1 AND g.clinical=1) OR (d.clinical=0 AND g.manage=1))));
CREATE TRIGGER IF NOT EXISTS professional_roles_server_only BEFORE UPDATE OF role ON accounts
 WHEN current_actor() != 'system' BEGIN SELECT RAISE(ABORT,'server_provisioning_only'); END;
-- Defense in depth for mutations, including accidental writes from application code.
CREATE TRIGGER IF NOT EXISTS request_insert_guard BEFORE INSERT ON requests
 WHEN current_actor()<>'system' AND NOT (
 NEW.requester=current_actor() AND EXISTS(SELECT 1 FROM active_grants g WHERE g.account=current_actor() AND g.patient=NEW.patient AND ((NEW.reason IN (0,1) AND g.manage=1) OR (NEW.reason IN (2,3,4) AND g.submit=1)))
 AND (NEW.center IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.patient=NEW.patient AND e.center=NEW.center)))
 BEGIN SELECT RAISE(ABORT,'request_insert_denied'); END;
CREATE TRIGGER IF NOT EXISTS request_update_guard BEFORE UPDATE ON requests
 WHEN current_actor()<>'system' AND (
 NOT EXISTS(SELECT 1 FROM visible_requests WHERE id=OLD.id)
 OR NEW.patient<>OLD.patient OR NEW.requester<>OLD.requester
 OR (NEW.center IS NOT OLD.center AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role IN ('personal','doctor')))
 OR (NEW.center IS NOT OLD.center AND NOT EXISTS(SELECT 1 FROM enrollments WHERE patient=NEW.patient AND center=NEW.center))
 OR (NEW.priority<OLD.priority AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role='doctor'))
 OR (EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role='family') AND
 (NEW.state<>OLD.state OR NEW.assigned IS NOT OLD.assigned OR NEW.accepted_by IS NOT OLD.accepted_by OR NEW.accepted_at IS NOT OLD.accepted_at OR NEW.due_at IS NOT OLD.due_at OR NEW.recorded_at IS NOT OLD.recorded_at)))
 BEGIN SELECT RAISE(ABORT,'request_update_denied'); END;
CREATE TRIGGER IF NOT EXISTS message_insert_guard BEFORE INSERT ON messages
 WHEN current_actor()<>'system' AND (
 NEW.author<>current_actor() OR NOT EXISTS(SELECT 1 FROM visible_requests WHERE id=NEW.request)
 OR (NEW.kind='clinical' AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role IN ('family','doctor'))))
 BEGIN SELECT RAISE(ABORT,'message_insert_denied'); END;
CREATE TRIGGER IF NOT EXISTS document_insert_guard BEFORE INSERT ON documents
 WHEN current_actor()<>'system' AND (
 NEW.uploader<>current_actor() OR NOT EXISTS(SELECT 1 FROM visible_requests WHERE id=NEW.request)
 OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role<>'family')
 OR (NEW.clinical=1 AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role='doctor')))
 BEGIN SELECT RAISE(ABORT,'document_insert_denied'); END;
CREATE TRIGGER IF NOT EXISTS document_approval_guard BEFORE UPDATE OF approved_by,approved_at ON documents
 WHEN current_actor()<>'system' AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role='doctor')
 BEGIN SELECT RAISE(ABORT,'doctor_approval_required'); END;
CREATE TRIGGER IF NOT EXISTS grants_update_guard BEFORE UPDATE ON grants
 WHEN current_actor()<>'system' AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=current_actor() AND role IN ('personal','doctor'))
 BEGIN SELECT RAISE(ABORT,'grant_update_denied'); END;
CREATE TRIGGER IF NOT EXISTS account_insert_guard BEFORE INSERT ON accounts
 WHEN current_actor()<>'system' BEGIN SELECT RAISE(ABORT,'server_provisioning_only'); END;
CREATE TRIGGER IF NOT EXISTS document_versions_immutable BEFORE UPDATE ON documents
 WHEN NEW.content IS NOT OLD.content OR NEW.audience<>OLD.audience OR NEW.clinical<>OLD.clinical
 OR NEW.request<>OLD.request OR NEW.version<>OLD.version OR NEW.series<>OLD.series
 BEGIN SELECT RAISE(ABORT,'new_document_version_required'); END;
CREATE TRIGGER IF NOT EXISTS messages_immutable BEFORE UPDATE ON messages
 BEGIN SELECT RAISE(ABORT,'messages_are_append_only'); END;
