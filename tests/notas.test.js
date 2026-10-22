const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simular, secuencia, servir, eventos, consultas } = require('./soporte');
const { calificacionEntera, idPositivo } = require('../utils/validaciones');
const rutas = [['/api/notas', 'notas.routes'], ['/api', 'actas.routes']];
const nota = { IdMatricula: 100, TipoEvaluacion: 'Simulacro', Calificacion: 1400 };
const lote = { idCiclo: 7, periodo: 'General', notas: [nota] };
const ciclo = { IdCiclo: 7, Nombre: 'Ciclo ficticio', UniversidadObjetivo: 'UNMSM' };
const evaluacion = { IdEvaluacion: 1, IdCiclo: 7, IdCurso: null, IdAcademia: 1, Periodo: 'General', TipoEvaluacion: 'Simulacro', EstadoRegistro: 1, UniversidadObjetivo: 'UNMSM' };
const cierre = { idCiclo: 7, idCurso: null, periodo: 'General', tipoEvaluacion: 'Simulacro' };
function alta(pasosFinales = []) {
  return secuencia([
    { sql: /FROM Ciclo.*FOR UPDATE/, params: [7, 1], rows: [ciclo] },
    { sql: /FROM Matricula m/, params: [100, 7, 1, 1], rows: [{ IdMatricula: 100, IdCurso: null }] },
    { sql: /COALESCE\(Periodo, 'General'\)/, params: [100, 'General', 'Simulacro'], rows: [] },
    { sql: /FROM Auditoria_Cierres.*FOR UPDATE/, params: [7, null, 'General', 'Simulacro'], rows: [] },
    ...pasosFinales,
  ]);
}

test('validacion numerica rechaza coerciones, decimales y overflow de IDs', () => {
  for (const v of [true, false, {}, [], [3], null, '', '1e2', '-1', '0x10', 1.5]) {
    assert.equal(idPositivo(v), null); assert.equal(calificacionEntera(v), null);
  }
  assert.equal(idPositivo(2147483648), null);
  assert.equal(calificacionEntera(0), 0);
});
for (const rol of ['Docente', 'Tutor de Aula', 'Alumno']) {
  test(rol + ' no gestiona notas ni cierres sin alcance verificable', async t => {
    simular(); const pedir = await servir(t, rutas, { id: 10, idAcademia: 1, rol });
    for (const [method, url, body] of [['GET','/api/notas'],['GET','/api/notas/contexto/7'],['GET','/api/notas/matriculas/7'],['POST','/api/notas',lote],['PUT','/api/notas/1',{Calificacion:1}],['PUT','/api/actas/cierre',cierre]]) {
      assert.equal((await pedir(method,url,body)).status,403,url);
    }
    assert.equal(consultas.length,0);
  });
}
test('historial propio aislado por identidad y academia sin columna de curso en Evaluacion', async t => {
  const fin=secuencia([{sql:/FROM Evaluacion e/,params:['10',1],rows:[],verificar(q){
    assert.match(q,/ci.IdAcademia = u.IdAcademia/);assert.match(q,/u.IdUsuario = \? AND u.IdAcademia = \?/);
    assert.doesNotMatch(q,/e\.IdCurso/);
  }}]);
  const pedir=await servir(t,rutas,{id:10,idAcademia:1,rol:'Alumno'});
  assert.equal((await pedir('GET','/api/notas/alumno/11')).status,403);
  assert.equal((await pedir('GET','/api/notas/alumno/10')).status,200);fin();
});
test('historial conserva claves de main y notas cerradas', async t => {
  simular(()=>[[{Calificacion:1000,UniversidadObjetivo:'UNMSM',EstadoRegistro:2},{Calificacion:1400,UniversidadObjetivo:'UNMSM',EstadoRegistro:1}]]);
  const pedir=await servir(t,rutas);const r=await pedir('GET','/api/notas/alumno/100');
  assert.equal(r.status,200);assert.equal(r.body.promedioGeneral,1200);assert.equal(r.body.escalaMaxima,2000);
  assert.equal(r.body.totalCursosEvaluados,2);assert.equal(r.body.historialNotas[0].EstadoRegistro,2);
});
test('ciclo, periodo y lote invalidos se rechazan antes de abrir transaccion', async t => {
  simular();const pedir=await servir(t,rutas);
  for(const body of [{...lote,idCiclo:true},{...lote,periodo:{}},{...lote,periodo:''},{...lote,notas:[]}])assert.equal((await pedir('POST','/api/notas',body)).status,400);
  assert.equal((await pedir('POST','/api/notas',{...lote,notas:Array(501).fill(nota)})).status,413);
  assert.deepEqual(eventos,[]);assert.equal(consultas.length,0);
});
test('tipos heredados peligrosos y calificaciones invalidas revierten sin insertar', async t => {
  const pedir=await servir(t,rutas);
  for(const cambio of [{TipoEvaluacion:'__proto__'},{TipoEvaluacion:'constructor'},{TipoEvaluacion:{}},{Calificacion:-1},{Calificacion:2001},{Calificacion:1.5},{Calificacion:true},{IdMatricula:[100]}]){
    const fin=secuencia([{sql:/FROM Ciclo/,rows:[ciclo]}]);
    assert.equal((await pedir('POST','/api/notas',{...lote,notas:[{...nota,...cambio}]})).status,400);
    fin();assert.deepEqual(eventos,['begin','rollback','release']);
  }
});
test('ciclo ajeno no admite notas',async t=>{
 const fin=secuencia([{sql:/FROM Ciclo.*IdAcademia = \?/,params:[7,1],rows:[]}]);
 const pedir=await servir(t,rutas);assert.equal((await pedir('POST','/api/notas',lote)).status,404);fin();
});
test('matricula ajena no admite notas aunque el ciclo sea valido',async t=>{
 const fin=secuencia([{sql:/FROM Ciclo/,rows:[ciclo]},{sql:/FROM Matricula m/,params:[100,7,1,1],rows:[]}]);
 const pedir=await servir(t,rutas);assert.equal((await pedir('POST','/api/notas',lote)).status,403);fin();
});
test('RRHH registra el simulacro sin exigir ni insertar Evaluacion.IdCurso',async t=>{
 const fin=alta([{sql:/^INSERT INTO Evaluacion/,params:[100,1400,'Simulacro','General',10],rows:{affectedRows:1},verificar(q){assert.doesNotMatch(q,/IdCurso/);}}]);
 const pedir=await servir(t,rutas,{id:10,idAcademia:1,rol:'Recursos Humanos'});
 assert.equal((await pedir('POST','/api/notas',lote)).status,201);fin();assert.deepEqual(eventos,['begin','commit','release']);
});
test('General conserva la regla de main que considera duplicado un historico NULL',async t=>{
 const fin=secuencia([{sql:/FROM Ciclo/,rows:[ciclo]},{sql:/FROM Matricula m/,rows:[{IdCurso:null}]},
 {sql:/COALESCE\(Periodo, 'General'\).*EstadoRegistro IN \(1, 2\)/,params:[100,'General','Simulacro'],rows:[{IdEvaluacion:9}]}]);
 const pedir=await servir(t,rutas);assert.equal((await pedir('POST','/api/notas',lote)).status,409);fin();
 assert.deepEqual(eventos,['begin','rollback','release']);
});
test('un fallo de insercion revierte y libera sin filtrar SQL',async t=>{
 const fin=alta([{sql:/INSERT INTO Evaluacion/,error:new Error('SELECT secreto_privado')}]);
 const pedir=await servir(t,rutas);const r=await pedir('POST','/api/notas',lote);
 assert.equal(r.status,500);assert.doesNotMatch(JSON.stringify(r.body),/SELECT|secreto_privado/);fin();assert.deepEqual(eventos,['begin','rollback','release']);
});
test('PUT comprueba cierre nuevamente dentro de la transaccion',async t=>{
 const fin=secuencia([{sql:/FROM Evaluacion e/,rows:[evaluacion]},{sql:/FROM Auditoria_Cierres/,rows:[]},
 {sql:/FROM Evaluacion e/,rows:[evaluacion]},{sql:/FROM Ciclo.*FOR UPDATE/,rows:[ciclo]},
 {sql:/SELECT EstadoRegistro FROM Evaluacion.*FOR UPDATE/,rows:[{EstadoRegistro:1}]},
 {sql:/FROM Auditoria_Cierres.*FOR UPDATE/,params:[7,null,'General','Simulacro'],rows:[{IdCierre:1}]}]);
 const pedir=await servir(t,rutas);assert.equal((await pedir('PUT','/api/notas/1',{Calificacion:1500})).status,403);fin();
 assert.deepEqual(eventos,['begin','rollback','release']);
});
test('historico NULL conserva General en el control de cierre legado',async t=>{
 const fin=secuencia([{sql:/FROM Evaluacion e/,rows:[{...evaluacion,Periodo:null}]},
 {sql:/FROM Auditoria_Cierres/,params:[7,null,'General','Simulacro',1],rows:[{IdCierre:1}]}]);
 const pedir=await servir(t,rutas);assert.equal((await pedir('PUT','/api/notas/1',{Calificacion:1500})).status,403);fin();
 assert.deepEqual(eventos,[]);
});
test('cierre legado sin notas conserva auditoria y respuesta de main',async t=>{
 const fin=secuencia([{sql:/FROM Ciclo/,rows:[ciclo]},{sql:/FROM Auditoria_Cierres/,rows:[]},
 {sql:/UPDATE Evaluacion.*m.IdCurso <=> \?/,rows:{affectedRows:0}},
 {sql:/INSERT INTO Auditoria_Cierres/,params:[10,7,null,'General','Simulacro'],rows:{insertId:1},verificar(q){assert.doesNotMatch(q,/RegistrosAfectados/);}}]);
 const pedir=await servir(t,rutas);const r=await pedir('PUT','/api/actas/cierre',cierre);
 assert.equal(r.status,200);assert.equal(r.body.evaluacionesSelladas,0);fin();assert.deepEqual(eventos,['begin','commit','release']);
});
test('fallo de auditoria revierte el cierre y RRHH conserva permisos',async t=>{
 const fin=secuencia([{sql:/FROM Ciclo/,rows:[ciclo]},{sql:/FROM Auditoria_Cierres/,rows:[]},
 {sql:/UPDATE Evaluacion/,params:[10,7,null,'General','Simulacro',1],rows:{affectedRows:2}},
 {sql:/INSERT INTO Auditoria_Cierres/,params:[10,7,null,'General','Simulacro'],error:new Error('Fallo simulado')}]);
 const pedir=await servir(t,rutas,{id:10,idAcademia:1,rol:'Recursos Humanos'});
 assert.equal((await pedir('PUT','/api/actas/cierre',cierre)).status,500);fin();assert.deepEqual(eventos,['begin','rollback','release']);
});
test('cierre conserva alias PascalCase de React y alcance nullable de main',async t=>{
 const fin=secuencia([{sql:/FROM Ciclo/,params:[7,1],rows:[ciclo]},{sql:/FROM Auditoria_Cierres/,rows:[]},
 {sql:/UPDATE Evaluacion/,rows:{affectedRows:2}},{sql:/INSERT INTO Auditoria_Cierres/,params:[10,7,null,'General','Simulacro'],rows:{insertId:1}}]);
 const pedir=await servir(t,rutas);const r=await pedir('PUT','/api/actas/cierre',{IdCiclo:'7',IdCurso:null,Periodo:'General',TipoEvaluacion:'Simulacro'});
 assert.equal(r.status,200);assert.equal(r.body.alcance.idCiclo,7);assert.equal(r.body.alcance.idCurso,null);assert.equal(r.body.evaluacionesSelladas,2);assert.ok(r.body.mensaje);fin();
});
test('tipo Evaluacion y alias IdCiclo de main siguen sin depender de cursos evaluados',async t=>{
 const fin=secuencia([{sql:/FROM Ciclo/,params:[7,1],rows:[ciclo]},{sql:/FROM Matricula/,rows:[{IdCurso:null}]},
 {sql:/COALESCE\(Periodo/,params:[100,'General','Evaluacion'],rows:[]},{sql:/FROM Auditoria_Cierres/,params:[7,null,'General','Evaluacion'],rows:[]},
 {sql:/INSERT INTO Evaluacion/,params:[100,1400,'Evaluacion','General',10],rows:{affectedRows:1}}]);
 const pedir=await servir(t,rutas);assert.equal((await pedir('POST','/api/notas',{IdCiclo:'7',notas:[{...nota,TipoEvaluacion:'Evaluacion'}]})).status,201);fin();
});
test('error de esquema falla cerrado sin exponer detalles internos',async t=>{
 simular(()=>{throw Object.assign(new Error('SQL privado'),{code:'ER_BAD_FIELD_ERROR'});});
 const pedir=await servir(t,rutas);const r=await pedir('GET','/api/notas');assert.equal(r.status,500);assert.doesNotMatch(JSON.stringify(r.body),/SQL privado/);
});

test('regresion de esquema: rutas activas no requieren columnas retiradas de la consolidacion',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const folder of ['routes','middlewares'])for(const file of fs.readdirSync(path.join(__dirname,'..',folder)).filter(f=>f.endsWith('.js'))){
  const source=fs.readFileSync(path.join(__dirname,'..',folder,file),'utf8');
  assert.doesNotMatch(source,/\be\d*\.IdCurso\b|\bEvaluacion\.IdCurso\b|\bRegistrosAfectados\b/,file);
 }
 const source=fs.readFileSync(path.join(__dirname,'../routes/notas.routes.js'),'utf8');
 const insert=source.match(/INSERT INTO Evaluacion\s*\(([^)]+)\)/);
 assert.ok(insert);assert.doesNotMatch(insert[1],/IdCurso/);
});


