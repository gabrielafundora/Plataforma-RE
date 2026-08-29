"use client";

import { useState } from "react";

// El único componente cliente de la app — necesario porque un
// <input type="number"> del navegador no acepta comas mientras se
// escribe. El input visible es texto, formateado con comas en cada
// tecla; el que de verdad viaja en el <form> es el hidden de abajo,
// con el número plano (sin comas), así que las server actions que
// reciben este campo (saveBudgetBaseline, lib/actions/budgetSetup.ts)
// no necesitan saber que esto existe.
function formatDisplay(raw: string): string {
  if (raw === "") return "";
  const [intPart, decPart] = raw.split(".");
  const withCommas = intPart === "" ? "" : Number(intPart).toLocaleString("en-US");
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

export function FormattedNumberField({
  name,
  defaultValue,
  className,
}: {
  name: string;
  defaultValue: number;
  className?: string;
}) {
  // Sin ".00" de sobra para un monto entero — String(120000000) ya da
  // "120000000"; solo trae decimales si defaultValue de verdad los tiene.
  const [raw, setRaw] = useState(() => (defaultValue ? String(defaultValue) : ""));

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = e.target.value
      .replace(/[^\d.]/g, "") // solo dígitos y punto -> nunca negativo
      .replace(/(\..*)\./g, "$1") // un solo punto decimal
      .replace(/(\.\d{2})\d+$/, "$1"); // máximo 2 decimales
    setRaw(cleaned);
  }

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        value={formatDisplay(raw)}
        onChange={handleChange}
        className={className}
      />
      <input type="hidden" name={name} value={raw === "" ? "0" : raw} />
    </>
  );
}
