#!/usr/bin/env python3
import argparse
import glob
import json
import os
import re
import sqlite3
from datetime import datetime
from uuid import uuid4


ARABIC_DIGITS = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
}

CATEGORY_MAP = {
    "موظف": "قيادات",
    "قيادات": "قيادات",
    "موظفصف": "مشرفون",
    "قياداتصف": "مشرفون",
    "فني": "فنيون",
    "فنيون": "فنيون",
    "إداري": "إداريون",
    "إداريون": "إداريون",
}

DEFAULT_RANK_BY_CATEGORY = {
    "قيادات": "موظف",
    "مشرفون": "موظف خدمات",
    "فنيون": "فني",
    "إداريون": "إداري",
}

RANK_ALIAS_MAP = {
    "و.ض": "مشرف مساعد",
    "مشرف مساعد": "مشرف مساعد",
    "وض": "مشرف مساعد",
    "وموظف": "مشرف مساعد",
    "و.ا.ض": "مشرف",
    "و.ا.موظف": "مشرف",
    "و.أ.ض": "مشرف",
    "مشرف": "مشرف",
}

PREFERRED_DEPARTMENT = "السجل العام"


def normalize_file_number(value: str) -> str:
    if value is None:
        return ""
    normalized = "".join(ARABIC_DIGITS.get(ch, ch) for ch in str(value).strip())
    return normalized.replace(" ", "")


def normalize_category(value: str) -> str:
    cleaned = str(value or "").strip().replace(" ", "")
    return CATEGORY_MAP.get(cleaned, "قيادات")


def normalize_rank(value: str, category: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "").strip())
    compact = cleaned.replace(" ", "")
    compact = compact.replace("إ", "ا").replace("أ", "ا").replace("آ", "ا").replace("ٱ", "ا")
    alias = RANK_ALIAS_MAP.get(compact)
    if alias:
        return alias
    if cleaned:
        return cleaned
    return DEFAULT_RANK_BY_CATEGORY.get(category, "موظف")


def normalize_path(value: str) -> str:
    return os.path.normpath(os.path.expandvars(os.path.expanduser(value)))


def detect_windows_user_from_cwd() -> str:
    cwd = os.getcwd().replace("\\", "/")
    match = re.search(r"^/mnt/c/Users/([^/]+)/", cwd)
    if match:
        return match.group(1)
    return ""


def collect_target_candidates() -> list:
    candidates = []
    seen = set()

    def add(path: str) -> None:
        if not path:
            return
        normalized = normalize_path(path)
        if normalized not in seen:
            seen.add(normalized)
            candidates.append(normalized)

    data_dir = os.getenv("DATA_DIR", "").strip()
    if data_dir:
        add(os.path.join(data_dir, "database.sqlite"))

    localappdata = os.getenv("LOCALAPPDATA", "").strip()
    if localappdata:
        add(os.path.join(localappdata, "gov-hr-suite", "database.sqlite"))

    win_user = os.getenv("WSL_WIN_USER", "").strip() or detect_windows_user_from_cwd()
    if win_user:
        add(f"/mnt/c/Users/{win_user}/AppData/Local/gov-hr-suite/database.sqlite")

    # Fallback scan for WSL environments where username is unknown.
    for path in glob.glob("/mnt/c/Users/*/AppData/Local/gov-hr-suite/database.sqlite"):
        add(path)

    add(os.path.join("backend", "database.sqlite"))
    add("database.sqlite")
    return candidates


def resolve_target_path(target_arg: str):
    requested = (target_arg or "").strip()
    if requested and requested.lower() != "auto":
        return normalize_path(requested), []

    candidates = collect_target_candidates()
    existing = [path for path in candidates if os.path.exists(path)]
    if not existing:
        return "", candidates

    # Prefer an app-data database if present (usually the active runtime DB).
    appdata_existing = [path for path in existing if "AppData" in path and "gov-hr-suite" in path]
    if appdata_existing:
        appdata_existing.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return appdata_existing[0], candidates

    return existing[0], candidates


def to_date_key(value: str) -> str:
    if not value:
        return ""
    if len(value) >= 10 and value[4] == "-" and value[7] == "-":
        return value[:10]
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return ""
    return parsed.strftime("%Y-%m-%d")


def ensure_licenses_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS Licenses (
            id TEXT PRIMARY KEY,
            employeeId TEXT NOT NULL,
            licenseType TEXT NOT NULL,
            licenseDate TEXT NOT NULL,
            hours REAL,
            notes TEXT,
            month INTEGER NOT NULL,
            year INTEGER NOT NULL,
            createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (employeeId) REFERENCES Employees(id)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_licenses_employee ON Licenses(employeeId)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_licenses_date ON Licenses(licenseDate)"
    )


def get_employee_columns(conn: sqlite3.Connection) -> set:
    rows = conn.execute("PRAGMA table_info(Employees)").fetchall()
    return {row[1] for row in rows}


def fetch_employee_maps(conn: sqlite3.Connection):
    columns = get_employee_columns(conn)
    has_civil_id = "civilId" in columns
    if has_civil_id:
        rows = conn.execute("SELECT id, fileNumber, civilId FROM Employees").fetchall()
    else:
        rows = conn.execute("SELECT id, fileNumber FROM Employees").fetchall()

    file_map = {}
    civil_map = {}
    duplicates = []

    for row in rows:
        employee_id = row[0]
        file_number = normalize_file_number(row[1])
        civil_id = normalize_file_number(row[2]) if has_civil_id and len(row) > 2 else ""

        if file_number:
            existing = file_map.get(file_number)
            if existing and existing != employee_id:
                duplicates.append(f"fileNumber:{file_number}")
            else:
                file_map[file_number] = employee_id

        if civil_id:
            existing = civil_map.get(civil_id)
            if existing and existing != employee_id:
                duplicates.append(f"civilId:{civil_id}")
            else:
                civil_map[civil_id] = employee_id

    return file_map, civil_map, duplicates


def build_source_employee_maps(source_employees: list):
    source_map_by_id = {}
    source_map_by_file = {}
    source_map_by_civil = {}
    for employee in source_employees:
        employee_id = str(employee.get("id", "")).strip()
        file_number = normalize_file_number(employee.get("file_number", ""))
        civil_id = normalize_file_number(
            employee.get("civil_id", "")
            or employee.get("civilId", "")
            or employee.get("civil_number", "")
            or employee.get("civilNumber", "")
        )
        if employee_id:
            source_map_by_id[employee_id] = {
                "file_number": file_number,
                "civil_id": civil_id,
            }
        if file_number and file_number not in source_map_by_file:
            source_map_by_file[file_number] = employee
        if civil_id and civil_id not in source_map_by_civil:
            source_map_by_civil[civil_id] = employee
    return source_map_by_id, source_map_by_file, source_map_by_civil


def first_normalized_value(row: dict, keys: list) -> str:
    for key in keys:
        value = normalize_file_number(row.get(key, ""))
        if value:
            return value
    return ""


def resolve_target_employee_id(
    license_row: dict,
    source_employee_map: dict,
    file_map: dict,
    civil_map: dict,
) -> tuple:
    direct_file_number = first_normalized_value(
        license_row,
        ["file_number", "fileNumber", "employee_file_number", "employeeFileNumber"],
    )
    direct_civil_id = first_normalized_value(
        license_row,
        ["civil_id", "civilId", "civil_number", "civilNumber", "employee_civil_id", "employeeCivilId"],
    )

    if direct_file_number:
        target_employee_id = file_map.get(direct_file_number)
        if target_employee_id:
            return target_employee_id, ""

    if direct_civil_id:
        target_employee_id = civil_map.get(direct_civil_id)
        if target_employee_id:
            return target_employee_id, ""

    legacy_employee_id = str(license_row.get("employee_id", "")).strip()
    source_identifier = source_employee_map.get(legacy_employee_id, {})
    file_number = source_identifier.get("file_number", "")
    civil_id = source_identifier.get("civil_id", "")

    target_employee_id = file_map.get(file_number) or civil_map.get(civil_id)
    if target_employee_id:
        return target_employee_id, ""

    missing_identifier = direct_file_number or direct_civil_id or file_number or civil_id or legacy_employee_id or "(missing)"
    return "", missing_identifier


def resolve_default_department(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        "SELECT name FROM Departments WHERE name = ? LIMIT 1", (PREFERRED_DEPARTMENT,)
    ).fetchone()
    if row:
        return row[0]

    row = conn.execute("SELECT name FROM Departments ORDER BY name LIMIT 1").fetchone()
    if row:
        return row[0]

    new_id = f"dep_mig_{uuid4().hex[:12]}"
    conn.execute(
        "INSERT INTO Departments (id, name) VALUES (?, ?)", (new_id, PREFERRED_DEPARTMENT)
    )
    return PREFERRED_DEPARTMENT


def ensure_rank_exists(conn: sqlite3.Connection, rank_name: str, category: str) -> None:
    row = conn.execute("SELECT id FROM Ranks WHERE name = ? LIMIT 1", (rank_name,)).fetchone()
    if row:
        return
    new_id = f"rank_mig_{uuid4().hex[:12]}"
    conn.execute(
        'INSERT INTO Ranks (id, name, category, "order") VALUES (?, ?, ?, ?)',
        (new_id, rank_name, category, 999),
    )


def create_missing_employees(
    conn: sqlite3.Connection,
    source_employees_by_file: dict,
    missing_identifiers: set,
    file_map: dict,
    civil_map: dict,
):
    created = 0
    unresolved = []
    default_department = resolve_default_department(conn)

    for raw_identifier in sorted(missing_identifiers):
        if not raw_identifier or raw_identifier.startswith("("):
            unresolved.append(raw_identifier)
            continue

        normalized_identifier = normalize_file_number(raw_identifier)
        if not normalized_identifier:
            unresolved.append(raw_identifier)
            continue

        if normalized_identifier in file_map or normalized_identifier in civil_map:
            continue

        source_employee = source_employees_by_file.get(normalized_identifier)
        if not source_employee:
            unresolved.append(raw_identifier)
            continue

        category = normalize_category(source_employee.get("category", ""))
        rank = normalize_rank(source_employee.get("rank", ""), category)
        ensure_rank_exists(conn, rank, category)

        employee_id = f"emp_legacy_{normalized_identifier}"
        existing_id = conn.execute(
            "SELECT 1 FROM Employees WHERE id = ? LIMIT 1", (employee_id,)
        ).fetchone()
        if existing_id:
            employee_id = f"{employee_id}_{uuid4().hex[:6]}"

        name = str(source_employee.get("full_name", "")).strip() or f"Legacy Employee {normalized_identifier}"
        include_in_shifts = 0 if category == "إداريون" else 1

        conn.execute(
            """
            INSERT INTO Employees (
                id,
                fileNumber,
                name,
                category,
                rank,
                department,
                status,
                includeInShifts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                employee_id,
                normalized_identifier,
                name,
                category,
                rank,
                default_department,
                "active",
                include_in_shifts,
            ),
        )
        file_map[normalized_identifier] = employee_id
        created += 1

    return created, unresolved


def prepare_license_rows(
    source_licenses: list,
    source_employee_map: dict,
    file_map: dict,
    civil_map: dict,
):
    rows = []
    missing_employee_ids = set()
    invalid_dates = 0

    for license_row in source_licenses:
        target_employee_id, missing_identifier = resolve_target_employee_id(
            license_row,
            source_employee_map,
            file_map,
            civil_map,
        )
        if not target_employee_id:
            missing_employee_ids.add(missing_identifier)
            continue

        license_id = str(license_row.get("id", "")).strip()
        license_type = license_row.get("license_type") or license_row.get("licenseType") or ""
        license_date_raw = (
            license_row.get("license_date")
            or license_row.get("licenseDate")
            or license_row.get("created_at")
            or license_row.get("createdAt")
            or ""
        )
        license_date = to_date_key(str(license_date_raw))
        if not license_date:
            invalid_dates += 1
            continue

        hours = license_row.get("hours")
        notes = license_row.get("notes") or license_row.get("note") or ""

        month = license_row.get("month")
        year = license_row.get("year")
        if not month or not year:
            try:
                parsed = datetime.fromisoformat(license_date)
                month = parsed.month
                year = parsed.year
            except ValueError:
                invalid_dates += 1
                continue

        created_at = license_row.get("created_at") or license_row.get("createdAt") or license_date
        updated_at = license_row.get("updated_at") or license_row.get("updatedAt") or created_at

        try:
            month_int = int(month)
            year_int = int(year)
        except (TypeError, ValueError):
            invalid_dates += 1
            continue

        rows.append(
            (
                license_id,
                target_employee_id,
                license_type,
                license_date,
                hours,
                notes,
                month_int,
                year_int,
                str(created_at),
                str(updated_at),
            )
        )

    return rows, missing_employee_ids, invalid_dates


def license_identity(row: tuple) -> tuple:
    return (
        row[1],
        row[2],
        row[3],
        "" if row[4] is None else str(row[4]),
        row[5] or "",
    )


def filter_new_license_rows(conn: sqlite3.Connection, rows: list) -> tuple:
    existing_ids = {
        row[0]
        for row in conn.execute("SELECT id FROM Licenses").fetchall()
    }
    existing_identities = {
        (
            row[0],
            row[1],
            row[2],
            "" if row[3] is None else str(row[3]),
            row[4] or "",
        )
        for row in conn.execute(
            """
            SELECT employeeId, licenseType, licenseDate, hours, notes
            FROM Licenses
            """
        ).fetchall()
    }

    new_rows = []
    skipped_existing = 0
    seen_ids = set()
    seen_identities = set()

    for row in rows:
        license_id = row[0]
        identity = license_identity(row)
        if license_id in existing_ids or license_id in seen_ids:
            skipped_existing += 1
            continue
        if identity in existing_identities or identity in seen_identities:
            skipped_existing += 1
            continue
        new_rows.append(row)
        seen_ids.add(license_id)
        seen_identities.add(identity)

    return new_rows, skipped_existing


def validate_unique_ids(licenses: list):
    seen = set()
    duplicates = []
    for item in licenses:
        raw_id = str(item.get("id", "")).strip()
        if not raw_id:
            duplicates.append("(missing-id)")
            continue
        if raw_id in seen:
            duplicates.append(raw_id)
        else:
            seen.add(raw_id)
    return len(duplicates) == 0, duplicates


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate licenses from legacy JSON to integrated SQLite database."
    )
    parser.add_argument(
        "--source",
        default=os.path.join("scripts", "database.json"),
        help="Path to legacy JSON database.",
    )
    parser.add_argument(
        "--target",
        default="auto",
        help="Path to target SQLite database. Use 'auto' to detect active DB.",
    )
    parser.add_argument(
        "--expected-count",
        type=int,
        default=0,
        help="Expected number of licenses to migrate. Use 0 to skip strict count validation.",
    )
    parser.add_argument(
        "--auto-create-missing-employees",
        action="store_true",
        help="Create missing Employees rows from source JSON when a file/civil number is not found. Do not use this for append-only imports.",
    )
    parser.add_argument(
        "--strict-missing-employees",
        action="store_true",
        help="Abort when source licenses reference employees that do not exist in the target database.",
    )
    args = parser.parse_args()

    args.source = normalize_path(args.source)
    resolved_target, candidates = resolve_target_path(args.target)
    if not resolved_target:
        print("Target database not found (auto-detect).")
        if candidates:
            print("Checked paths:")
            for candidate in candidates[:15]:
                print(f"- {candidate}")
        return 1
    args.target = resolved_target

    target_ext = os.path.splitext(args.target)[1].lower()
    if target_ext != ".sqlite":
        print(
            "Target database has unsupported extension. "
            f"Expected '.sqlite', got '{target_ext or '(none)'}'."
        )
        print(f"Target path: {args.target}")
        return 1

    if not os.path.exists(args.source):
        print(f"Source JSON not found: {args.source}")
        return 1
    if not os.path.exists(args.target):
        print(f"Target database not found: {args.target}")
        return 1

    print(f"Target database: {args.target}")

    with open(args.source, "r", encoding="utf-8") as handle:
        source_data = json.load(handle)

    source_employees = source_data.get("employees", [])
    source_licenses = source_data.get("licenses", [])
    if not source_licenses:
        print("No licenses found in source JSON.")
        return 0
    if args.expected_count and len(source_licenses) != args.expected_count:
        print(
            "Source license count does not match expected count. "
            f"Found {len(source_licenses)}, expected {args.expected_count}."
        )
        return 1

    unique_ok, duplicate_ids = validate_unique_ids(source_licenses)
    if not unique_ok:
        print("Duplicate or missing license IDs found. Aborting.")
        for item in duplicate_ids[:10]:
            print(f"- {item}")
        return 1

    conn = sqlite3.connect(args.target)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        file_map, civil_map, duplicates = fetch_employee_maps(conn)
    finally:
        conn.close()

    if duplicates:
        print("Duplicate employee identifiers detected. Aborting.")
        for item in duplicates[:10]:
            print(f"- {item}")
        return 1

    source_employee_map, source_employees_by_file, _source_employees_by_civil = build_source_employee_maps(source_employees)

    rows, missing_employee_ids, invalid_dates = prepare_license_rows(
        source_licenses,
        source_employee_map,
        file_map,
        civil_map,
    )

    auto_created_employees = 0
    if missing_employee_ids and args.auto_create_missing_employees:
        conn = sqlite3.connect(args.target)
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            conn.execute("BEGIN")
            auto_created_employees, unresolved = create_missing_employees(
                conn,
                source_employees_by_file,
                missing_employee_ids,
                file_map,
                civil_map,
            )
            if unresolved:
                conn.execute("ROLLBACK")
                print("Some missing employees could not be auto-created. Aborting.")
                for item in unresolved[:10]:
                    print(f"- {item}")
                return 1
            conn.execute("COMMIT")
        except Exception as exc:
            conn.execute("ROLLBACK")
            print(f"Failed while auto-creating missing employees: {exc}")
            return 1
        finally:
            conn.close()

        conn = sqlite3.connect(args.target)
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            file_map, civil_map, duplicates = fetch_employee_maps(conn)
        finally:
            conn.close()

        if duplicates:
            print("Duplicate employee identifiers detected after auto-create. Aborting.")
            for item in duplicates[:10]:
                print(f"- {item}")
            return 1

        rows, missing_employee_ids, invalid_dates = prepare_license_rows(
            source_licenses,
            source_employee_map,
            file_map,
            civil_map,
        )

    if invalid_dates:
        print(f"Invalid license dates found: {invalid_dates}. Aborting.")
        return 1
    if missing_employee_ids and args.strict_missing_employees:
        print(
            "Missing employee matches. Aborting before making changes."
        )
        sample = list(sorted(missing_employee_ids))[:10]
        for item in sample:
            print(f"- {item}")
        return 1
    if args.expected_count and len(rows) != args.expected_count:
        print(
            "Prepared license count does not match expected count. "
            f"Prepared {len(rows)}, expected {args.expected_count}."
        )
        return 1

    conn = sqlite3.connect(args.target)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        conn.execute("BEGIN")
        ensure_licenses_table(conn)
        rows_to_insert, skipped_existing = filter_new_license_rows(conn, rows)
        conn.executemany(
            """
            INSERT INTO Licenses (
                id,
                employeeId,
                licenseType,
                licenseDate,
                hours,
                notes,
                month,
                year,
                createdAt,
                updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )
        count = conn.execute("SELECT COUNT(*) FROM Licenses").fetchone()[0]
        if args.expected_count and len(rows) != args.expected_count:
            conn.execute("ROLLBACK")
            print(
                "Prepared license count does not match expected count. "
                f"Prepared {len(rows)}, expected {args.expected_count}. Rollback applied."
            )
            return 1
        conn.execute("COMMIT")
    except Exception as exc:
        conn.execute("ROLLBACK")
        print(f"Migration failed: {exc}")
        return 1
    finally:
        conn.close()

    print(f"Source licenses: {len(source_licenses)}")
    print(f"Matched to existing employees: {len(rows)}")
    print(f"Inserted: {len(rows_to_insert)}")
    print(f"Skipped existing: {skipped_existing}")
    if missing_employee_ids:
        print(f"Skipped missing employees: {len(missing_employee_ids)}")
        for item in list(sorted(missing_employee_ids))[:10]:
            print(f"- {item}")
    if auto_created_employees:
        print(f"Auto-created employees: {auto_created_employees}")
    print("Migration completed successfully.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
