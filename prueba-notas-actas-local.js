const assert = require('node:assert/strict');
const express = require('express');
// Flujo de main con datos ficticios. Nunca se conecta a Aiven.
const evaluaciones = [], cierres = [];
let siguienteId = 1, respaldo, falloInsercionEn = 0, falloAuditoria = false, pruebas = 0;
const copia = value => JSON.parse(JSON.stringify(value));
const clave = (ciclo, curso, periodo, tipo) => JSON.stringify([Number(ciclo),curso ?? null,periodo,tipo]);
async function query(sql, p=[]) {
 const q=sql.replace(/\s+/g,' ').trim();
 assert.equal((q.match(/\?/g)||[]).length,p.length,'Parametros completos');
 assert.doesNotMatch(q,/e\.IdCurso|RegistrosAfectados/);
 if(/\bFROM Ciclo\b/.test(q))return [[7,8].includes(Number(p[0]))&&Number(p[1])===1?[{IdCiclo:Number(p[0]),Nombre:'Ciclo ficticio',UniversidadObjetivo:'UNMSM'}]:[]];
 if(/FROM Matricula m/.test(q))return [[100,101].includes(Number(p[0]))&&Number(p[1])===7&&p[2]===1?[{IdMatricula:Number(p[0]),IdCurso:null}]:[]];
 if(/FROM Auditoria_Cierres/.test(q))return [cierres.includes(clave(...p))?[{IdCierre:1}]:[]];
 if(/FROM Evaluacion WHERE IdMatricula/.test(q))return [evaluaciones.filter(e=>e.IdMatricula===p[0]&&(e.Periodo??'General')===p[1]&&e.TipoEvaluacion===p[2]&&[1,2].includes(e.EstadoRegistro))];
 if(/SELECT EstadoRegistro FROM Evaluacion/.test(q))return [evaluaciones.filter(e=>e.IdEvaluacion===Number(p[0]))];
 if(/FROM Evaluacion e/.test(q)) {
   if(/e.IdEvaluacion = \?/.test(q))return [evaluaciones.filter(e=>e.IdEvaluacion===Number(p[0])).map(e=>({...e,IdCiclo:7,IdCurso:null,IdAcademia:1,UniversidadObjetivo:'UNMSM'}))];
   return [evaluaciones.filter(e=>[1,2].includes(e.EstadoRegistro)).map(e=>({...e,Curso:'Simulacro general',UniversidadObjetivo:'UNMSM'}))];
 }
 if(/^INSERT INTO Evaluacion/.test(q)) {
   assert.doesNotMatch(q,/IdCurso/);
   if(falloInsercionEn>0&&--falloInsercionEn===0)throw Error('Fallo de insercion simulado');
   evaluaciones.push({IdEvaluacion:siguienteId++,IdMatricula:p[0],Calificacion:p[1],TipoEvaluacion:p[2],Periodo:p[3],EstadoRegistro:1});
   return [{affectedRows:1,insertId:siguienteId-1}];
 }
 if(/^UPDATE Evaluacion e/.test(q)&&/SET e.EstadoRegistro = 2/.test(q)) {
   assert.match(q,/m.IdCurso <=> \?/);assert.match(q,/e.Periodo = \?/);assert.match(q,/e.TipoEvaluacion = \?/);
   let affectedRows=0;for(const e of evaluaciones)if(p[1]===7&&p[2]===null&&e.Periodo===p[3]&&e.TipoEvaluacion===p[4]&&e.EstadoRegistro===1){e.EstadoRegistro=2;affectedRows++;}
   return [{affectedRows}];
 }
 if(/^UPDATE Evaluacion e/.test(q)&&/SET e.Calificacion/.test(q)) {
   const e=evaluaciones.find(e=>e.IdEvaluacion===p[2]&&e.EstadoRegistro===1);if(e)e.Calificacion=p[0];return [{affectedRows:e?1:0}];
 }
 if(/^INSERT INTO Auditoria_Cierres/.test(q)) {
   if(falloAuditoria)throw Error('Fallo de auditoria simulado');
   cierres.push(clave(...p.slice(1)));return [{affectedRows:1,insertId:cierres.length}];
 }
 throw Error('Consulta no simulada: '+q);
}
const connection={query,async beginTransaction(){respaldo={evaluaciones:copia(evaluaciones),cierres:copia(cierres),siguienteId};},
 async commit(){respaldo=null;},async rollback(){if(!respaldo)return;evaluaciones.splice(0,evaluaciones.length,...respaldo.evaluaciones);cierres.splice(0,cierres.length,...respaldo.cierres);siguienteId=respaldo.siguienteId;respaldo=null;},release(){}};
const dbPath=require.resolve('./config/db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query,getConnection:async()=>connection}};
const app=express();app.use(express.json());app.use((req,res,next)=>{req.usuario={id:10,idAcademia:1,rol:req.headers['x-rol-prueba']||'Administrador'};next();});
app.use('/api/notas',require('./routes/notas.routes'));app.use('/api',require('./routes/actas.routes'));
const server=app.listen(0,'127.0.0.1',async()=>{
 const base=`http://127.0.0.1:${server.address().port}`;
 async function probar(nombre,metodo,ruta,body,esperado,rol='Administrador') {
   const response=await fetch(base+ruta,{method:metodo,headers:{'Content-Type':'application/json','x-rol-prueba':rol},body:body===undefined?undefined:JSON.stringify(body)});
   const result=await response.json();assert.equal(response.status,esperado,nombre+': '+JSON.stringify(result));pruebas++;console.log('OK - '+nombre);return result;
 }
 const lote=(periodo='General',id=100)=>({idCiclo:7,periodo,notas:[{IdMatricula:id,TipoEvaluacion:'Simulacro',Calificacion:1400}]});
 const cierre={idCiclo:7,idCurso:null,periodo:'General',tipoEvaluacion:'Simulacro'};
 try {
   await probar('Registrar simulacro sin curso','POST','/api/notas',lote(),201);
   await probar('Registrar otro periodo','POST','/api/notas',lote('Periodo B'),201);
   await probar('Modificar nota abierta','PUT','/api/notas/1',{Calificacion:1500},200);assert.equal(evaluaciones[0].Calificacion,1500);
   await probar('Duplicado abierto rechazado','POST','/api/notas',lote(),409);assert.equal(evaluaciones.length,2);
   await probar('Cierre legado del periodo General','PUT','/api/actas/cierre',cierre,200);
   assert.equal(evaluaciones[0].EstadoRegistro,2);assert.equal(evaluaciones[1].EstadoRegistro,1);
   const listado=await probar('Cerradas siguen visibles','GET','/api/notas',undefined,200);assert.equal(listado.length,2);assert.equal(listado[0].EstadoRegistro,2);
   await probar('RRHH consulta notas','GET','/api/notas',undefined,200,'Recursos Humanos');
   await probar('Nota cerrada no editable','PUT','/api/notas/1',{Calificacion:1600},403);
   await probar('Duplicado cerrado rechazado','POST','/api/notas',lote(),409);
   await probar('Cierre impide alta de otro alumno','POST','/api/notas',lote('General',101),403);
   await probar('Otro periodo permanece abierto','PUT','/api/notas/2',{Calificacion:1700},200);
   await probar('Decimal rechazado','POST','/api/notas',{...lote('Periodo C'),notas:[{...lote().notas[0],Calificacion:1.5}]},400);
   await probar('Docente no escribe sin alcance','POST','/api/notas',lote('Periodo C'),403,'Docente');
   const antes=copia(evaluaciones);
   await probar('Lote invalido no escribe parcialmente','POST','/api/notas',{...lote('Periodo C'),notas:[lote().notas[0],{...lote().notas[0],IdMatricula:101,Calificacion:2001}]},400);assert.deepEqual(evaluaciones,antes);
   falloInsercionEn=2;
   await probar('Fallo en segunda insercion revierte lote','POST','/api/notas',{...lote('Periodo C'),notas:[lote().notas[0],{...lote().notas[0],IdMatricula:101}]},500);assert.deepEqual(evaluaciones,antes);
   const cierresAntes=copia(cierres);falloAuditoria=true;
   await probar('Fallo de auditoria restaura notas','PUT','/api/actas/cierre',{...cierre,periodo:'Periodo B'},500);assert.deepEqual(evaluaciones,antes);assert.deepEqual(cierres,cierresAntes);falloAuditoria=false;
   await probar('RRHH cierra periodo B','PUT','/api/actas/cierre',{...cierre,periodo:'Periodo B'},200,'Recursos Humanos');
   assert.ok(evaluaciones.every(e=>e.EstadoRegistro===2));
   await probar('Cierre repetido rechazado','PUT','/api/actas/cierre',{...cierre,periodo:'Periodo B'},409);
   await probar('Periodo B cerrado no editable','PUT','/api/notas/2',{Calificacion:1500},403);
   await probar('Otro periodo admite notas','POST','/api/notas',lote('Periodo C'),201);
   await probar('Lote repetido se revierte completo','POST','/api/notas',{...lote('Periodo D'),notas:[lote().notas[0],lote().notas[0]]},409);
   console.log(`${pruebas} pruebas locales correctas. Sin Aiven.`);
 }catch(error){console.error('PRUEBA FALLIDA:',error.message);process.exitCode=1;}finally{server.close();server.closeAllConnections();}
});


