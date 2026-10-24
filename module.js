import {
  F,
  S,
  R,
  C,
  live,
  rows,
  byId,
  unique,
  required,
  minor,
  amount,
  interval,
  noOverlap,
  changed,
  immutable,
  admin,
  totalLines,
  summary,
  clock,
  label,
} from "./core/rules.js";
const definition = {
  slug: "qoldau-invoice",
  reference: 62,
  title: "Qoldau Invoice",
  description:
    "Счета, строки и ручная сверка частичных оплат с проверкой остатка. Без приёма платежей и налоговых документов.",
  limitations:
    "Одна организация · Собственный сервер · Ручной ввод · Без банковских и внешних интеграций",
  collections: [
    C("clients", "Клиенты", [
      F("name", "Название"),
      F("email", "Деловая почта", "email", { required: false }),
    ]),
    C("invoices", "Счета", [
      F("number", "Номер"),
      R("client", "Клиент", "clients"),
      S("currency", "Валюта", ["KZT", "USD", "KGS", "UZS"]),
      F("due", "Срок", "date"),
      S("status", "Статус", [
        ["draft", "Черновик"],
        ["issued", "Выставление отмечено"],
        ["cancelled", "Отменён"],
      ]),
    ]),
    C("lines", "Позиции", [
      R("invoice", "Счёт", "invoices"),
      F("description", "Позиция"),
      F("quantity", "Количество", "number", { min: 0.01, max: 1000000 }),
      F("price", "Цена за единицу", "money"),
    ]),
    C("payments", "Ручные отметки оплаты", [
      R("invoice", "Счёт", "invoices"),
      F("reference", "Внешнее подтверждение"),
      F("amount", "Сумма", "money"),
      F("date", "Дата", "date"),
    ]),
  ],
  validate(state, before, command, actor) {
    unique(rows(state, "invoices"), "number", "Номер счёта");
    for (const invoice of rows(state, "invoices")) {
      const old = changed(before, "invoices", invoice.id),
        sum = totalLines(state, "lines", "invoice", invoice.id),
        paid = rows(state, "payments")
          .filter((p) => p.invoice === invoice.id)
          .reduce((s, p) => s + minor(p.amount), 0);
      required(paid <= sum, "Оплата превышает сумму счёта.");
      if (invoice.status === "issued")
        required(sum > 0, "Добавьте положительные позиции до выставления.");
      if (invoice.status === "cancelled")
        required(
          paid === 0,
          "Оплаченный счёт нельзя отменить без отдельной сверки.",
        );
      if (old?.status === "issued")
        immutable(old, invoice, ["number", "client", "currency"]);
      if (paid)
        required(
          invoice.status === "issued",
          "Оплаты допускаются только у выставленного счёта.",
        );
    }
    for (const line of rows(state, "lines")) {
      const old = changed(before, "lines", line.id),
        parent = byId(state, "invoices", line.invoice),
        previousParent = old && byId(before, "invoices", old.invoice);
      if (
        parent.status !== "draft" ||
        (previousParent && previousParent.status !== "draft")
      )
        required(
          old && JSON.stringify(old) === JSON.stringify(line),
          "Позиции можно менять и переносить только между черновиками счетов.",
        );
    }
    for (const payment of rows(state, "payments")) {
      required(
        minor(payment.amount) > 0 && !payment.archived,
        "Оплату нельзя обнулить или скрыть архивированием.",
      );
      const old = changed(before, "payments", payment.id);
      if (old)
        immutable(old, payment, [
          "invoice",
          "reference",
          "amount",
          "date",
          "archived",
        ]);
    }
  },
  summarize(state) {
    return rows(state, "invoices").map((x) => {
      const sum = totalLines(state, "lines", "invoice", x.id),
        paid = rows(state, "payments")
          .filter((p) => p.invoice === x.id)
          .reduce((s, p) => s + minor(p.amount), 0);
      return summary(
        x.number + " · " + x.currency,
        "Сумма: " + amount(sum),
        "Отмечено оплат: " + amount(paid),
        "Остаток: " + amount(sum - paid),
      );
    });
  },
};
export default definition;
