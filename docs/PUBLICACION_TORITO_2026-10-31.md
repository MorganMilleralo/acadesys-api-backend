# Registro para publicación a main — 31/10/2026

El usuario solicitó publicar directamente en origin/main, sin PR. Respondió
«CONFIRMO» a la verificación en DBeaver de las tarifas de los nueve ciclos
1, 2, 3, 5, 6, 10, 11, 12 y 13 y a la autorización del posible despliegue
automático que dispare el push. No se comprobó el ajuste Auto-Deploy en Render
ni se iniciará un despliegue manual. No se declara QA real de React/MySQL.

El origen es https://github.com/MorganMilleralo/acadesys-api-backend.git.
Tras fetch, origin/main permanece en 6944740 y es ancestro de la rama de Torito.
Se conservan íntegramente d16a183 y 4554f37 junto con todos sus antecesores del
equipo. El ajuste final es un commit adicional, sin reescribir esos commits.

## Compatibilidad histórica solicitada

Se mantiene rango 1–120 e inicial 100 para nuevas capacidades. Los registros
persistidos conservan su funcionamiento previo: 0/NULL sin límite configurado;
250 u otros enteros positivos mantienen su aforo y se bloquean al llenarse.
Lectura, disponibilidad, matrícula y reapertura usan esa compatibilidad; el
aviso de revisión no bloquea su operación. Se acepta reenviar la misma capacidad
histórica al editar otro dato; cambiarla exige 1–120 y no bajar de los inscritos.
No se actualizaron registros históricos, no se expulsaron alumnos y se conserva
la concurrencia del checkout. No se añadieron excepciones por ID ni campos de BD.

Precios: se preserva el contrato de Morgan. Inscripción NULL recurre a Precio
legado válido; si tampoco existe, checkout devuelve 409 sin crear un pago.
Mensualidad NULL devuelve 409 y nunca hereda Precio. Un pago emitido conserva
su importe aunque cambie la tarifa; confirmar correo no confirma un cobro.
Los IDs 4, 14 y 15 no reciben asignaciones por parte de Codex. El SQL preparado
no se ejecutó y no forma parte del arranque del servidor.

## Verificación y alcance

- 218 pruebas aprobadas: 188 node:test, 4 autenticación, 5 cierre y 21 notas/actas.
- Sintaxis, dependencias y git diff --check revisados; sin secretos detectados
  en la revisión acotada. No se incluyen .env ni archivos locales ajenos.
- Rutas de pagos, checkout/matrícula y alumno, utils/pagos y manifiestos de
  dependencias idénticos a origin/main; el ajuste utiliza la regla compartida de
  capacidad sin modificar el módulo financiero de Morgan.
- No se tocó Aiven ni frontend; no hubo pruebas reales contra MySQL ni Render.
- .vscode/extensions.json y el parche histórico permanecen fuera del commit.

Este registro documenta la preparación y autorización. El resultado del push y
el hash remoto se verifican después y se comunican en el cierre de la sesión;
no se afirma que el despliegue de Render haya finalizado por publicar el commit.
