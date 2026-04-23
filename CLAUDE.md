# CLAUDE.md — Sistema de Stock Centralizado (Inventario Obras)

## Qué es este proyecto

Sistema de inventario multi-depósito para materiales de construcción. App web mobile-first con backend serverless en Google Apps Script y Google Sheets como base de datos.

## Stack

- **Frontend**: HTML5 + JS vanilla + CSS (archivo único, sin build)
- **Backend**: Google Apps Script (endpoints JSON vía `doGet`/`doPost`)
- **Base de datos**: Google Sheets (7 hojas)
- **Storage**: Google Drive (fotos y QRs)
- **Auth**: Token API compartido (MVP)

## Archivos principales

- `03_AppsScript_API.gs` — Backend (~400 líneas)
- `index.html` — Frontend single-file (~2500 líneas, sirve para local + GitHub Pages)
- `01_DISEÑO_Sistema_Stock.md` — Specs y modelo completo
- `02_Plantilla_Stock.xlsx` — Plantilla del Google Sheet
- `05_Guia_Implementacion.md` — Paso a paso de setup

## Convenciones

- Todo en **castellano rioplatense** (usuarios argentinos)
- SKU, códigos de zona y obra siempre en **MAYÚSCULAS**
- Nombres de hojas del Sheet hardcoded como constantes al inicio del `.gs`
- Tipos de movimiento (enum cerrado): `Ingreso | Traslado | Egreso | Ajuste | Reserva | Libera_Reserva`
- Fotos y QRs se nombran `{SKU}_{nombre_sanitizado}.{ext}`
- El stock **no se guarda** — se calcula siempre desde el log de Movimientos (fuente de verdad)
- Anular = movimiento inverso (nunca borrar filas de Movimientos)
- Sin frameworks en el frontend — un solo HTML, sin build step

## Reglas para contribuir

- No agregar dependencias ni frameworks sin justificación clara
- Mantener el frontend como archivo único (sin build step)
- Respetar el enum de tipos de movimiento — cambios requieren actualizar validaciones en `.gs` y fórmulas en `.xlsx`
- Comentarios en castellano
- Probar cambios de backend redesplegando en Apps Script (nueva versión)
- Probar cambios de frontend abriendo el HTML en el navegador directamente
