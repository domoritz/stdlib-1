import {require as requireDefault} from "d3-require";
import {sql} from "./dependencies";

export default async function sqlite(require) {
  const init = await require(sql.resolve());
  return init({locateFile: file => sql.resolve(`dist/${file}`)});
}

export class SQLiteDatabaseClient {
  constructor(db) {
    Object.defineProperties(this, {
      _db: {value: db}
    });
  }
  static async open(source) {
    const [SQL, buffer] = await Promise.all([sqlite(requireDefault), Promise.resolve(source).then(load)]);
    return new SQLiteDatabaseClient(new SQL.Database(buffer));
  }
  async query(query, params) {
    return await exec(this._db, query, params);
  }
  async queryRow(query, params) {
    return (await this.query(query, params))[0] || null;
  }
  async explain(query, params) {
    const rows = await this.query(`EXPLAIN QUERY PLAN ${query}`, params);
    return element("pre", {className: "observablehq--inspect"}, [
      text(rows.map(row => row.detail).join("\n"))
    ]);
  }
  async describe(object) {
    const rows = await (object === undefined
      ? this.query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      : this.query(`SELECT * FROM pragma_table_info(?)`, [object]));
    if (!rows.length) throw new Error("Not found");
    const {columns} = rows;
    return element("table", {value: rows}, [
      element("thead", [element("tr", columns.map(c => element("th", [text(c)])))]),
      element("tbody", rows.map(r => element("tr", columns.map(c => element("td", [text(r[c])])))))
    ]);
  }
  async schema(table) {
    if (table === undefined) {
      const rows = await this.query(`SELECT name FROM sqlite_master WHERE type = 'table'`);
      return {
        type: "object",
        properties: Object.fromEntries(rows.map(r => [r.name, {type: "array", items: {type: "object"}}]))
      };
    } else {
      const rows = await this.query(`SELECT * FROM pragma_table_info(?)`, [table]);
      if (!rows.length) throw new Error(`table not found: ${table}`);
      return {
        type: "object",
        properties: Object.fromEntries(rows.map(({name, type, notnull}) => {
          const t = sqliteType(type);
          return [name, {
            type: notnull || t === "null" ? t : [t, "null"],
            databaseType: type
          }];
        }))
      };
    }
  }
  async sql(strings, ...args) {
    return this.query(strings.join("?"), args);
  }
}

Object.defineProperty(SQLiteDatabaseClient.prototype, "dialect", {
  value: "sqlite"
});

// https://www.sqlite.org/datatype3.html
function sqliteType(type) {
  switch (type) {
    case "NULL":
      return "null";
    case "INT":
    case "INTEGER":
    case "TINYINT":
    case "SMALLINT":
    case "MEDIUMINT":
    case "BIGINT":
    case "UNSIGNED BIG INT":
    case "INT2":
    case "INT8":
      return "integer";
    case "TEXT":
    case "CLOB":
      return "string";
    case "REAL":
    case "DOUBLE":
    case "DOUBLE PRECISION":
    case "FLOAT":
    case "NUMERIC":
      return "number";
    case "BLOB":
      return "buffer";
    case "DATE":
    case "DATETIME":
      return "string"; // TODO convert strings to Date instances
    default:
      return /^(?:(?:(?:VARYING|NATIVE) )?CHARACTER|(?:N|VAR|NVAR)CHAR)\(/.test(type) ? "string"
        : /^(?:DECIMAL|NUMERIC)\(/.test(type) ? "number"
        : "other";
  }
}

function load(source) {
  return typeof source === "string" ? fetch(source).then(load)
    : source instanceof Response || source instanceof Blob ? source.arrayBuffer().then(load)
    : source instanceof ArrayBuffer ? new Uint8Array(source)
    : source;
}

async function exec(db, query, params) {
  const [result] = await db.exec(query, params);
  if (!result) return [];
  const {columns, values} = result;
  const rows = values.map(row => Object.fromEntries(row.map((value, i) => [columns[i], value])));
  rows.columns = columns;
  return rows;
}

function element(name, props, children) {
  if (arguments.length === 2) children = props, props = undefined;
  const element = document.createElement(name);
  if (props !== undefined) for (const p in props) element[p] = props[p];
  if (children !== undefined) for (const c of children) element.appendChild(c);
  return element;
}

function text(value) {
  return document.createTextNode(value);
}
