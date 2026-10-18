import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceDomain } from "../src/lib/anonymize.js";
import { normalizeDomain } from "../src/lib/settings.js";

test("replaceDomain replaces domain and subdomains, case-insensitive", () => {
  const text = "ivan@Company.ru, https://mail.company.ru/x, company.ru.";
  assert.equal(replaceDomain(text, "company.ru"), "ivan@example.com, https://mail.example.com/x, example.com.");
});

test("replaceDomain keeps lookalike domains", () => {
  assert.equal(replaceDomain("mycompany.ru company.rus", "company.ru"), "mycompany.ru company.rus");
});

test("replaceDomain handles cyrillic domains", () => {
  assert.equal(replaceDomain("почта@компания.рф", "компания.рф"), "почта@example.com");
});

test("replaceDomain with empty domain leaves text", () => {
  assert.equal(replaceDomain("a@company.ru", ""), "a@company.ru");
});

test("normalizeDomain cleans user input", () => {
  assert.equal(normalizeDomain("  https://Company.RU/path "), "company.ru");
  assert.equal(normalizeDomain("@company.ru"), "company.ru");
  assert.equal(normalizeDomain("user@mail.company.ru"), "mail.company.ru");
  assert.equal(normalizeDomain("company.ru:443"), "company.ru");
  assert.equal(normalizeDomain(""), "");
});

test("normalizeDomain rejects non-domains", () => {
  assert.throws(() => normalizeDomain("company"), /Некорректный домен/);
  assert.throws(() => normalizeDomain("comp any.ru"), /Некорректный домен/);
});
