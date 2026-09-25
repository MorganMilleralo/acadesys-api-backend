const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configuración global del modelo Gemini con salida JSON forzada y lectura diferida de variables de entorno
const getModelConfig = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('La variable de entorno GEMINI_API_KEY no está configurada en el servidor.');
  }

<<<<<<< HEAD
  const client = new GoogleGenerativeAI(apiKey);
  return client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      temperature: 0.2, // Respuestas deterministas y precisas
      responseMimeType: 'application/json' // Garantiza JSON puro sin markdown
    }
  });
};

// ============================================================================
// ENDPOINT 1: Diagnóstico Pedagógico y Plan de Refuerzo UNI / San Marcos
// ============================================================================
router.post('/tutor-ia/diagnostico', async (req, res) => {
  try {
    const { alumno, historialNotas } = req.body;

    if (!alumno) {
      return res.status(400).json({ error: 'Faltan los datos del alumno para el diagnóstico.' });
    }

    const model = getModelConfig();

    const prompt = `
Eres el Tutor Pedagógico y Estratega Académico de AcadeSys, especializado en preparación preuniversitaria del Perú (UNI, UNMSM, UNFV, PUCP).
Tu tarea es analizar el perfil del estudiante y su desempeño académico según el estándar de vacantes y puntajes de admisión nacional.

DATOS DEL ALUMNO:
- Nombre: ${alumno.nombre || 'Estudiante'}
- Aula / Ciclo: ${alumno.aula || 'Ciclo Anual / Semestral'}
- Promedio Ponderado: ${alumno.promedio || 'Sin promedio registrado'}/20
- Historial de Notas: ${JSON.stringify(historialNotas || [])}

REGLAS DE EVALUACIÓN:
1. Analiza cursos críticos (notas menores a 13) con especial atención a Matemáticas (Álgebra, Geometría, RM, Trigonometría) y Ciencias (Física, Química).
2. Si el objetivo o estilo es UNI, prioriza rigor algebraico, cinemática vectorial y exactitud operativa.
3. Si el objetivo o estilo es San Marcos (UNMSM), prioriza razonamiento verbal, lectura crítica y ejercicios tipo DECO.

Genera EXCLUSIVAMENTE un objeto JSON válido con este esquema exacto:
{
  "resumenGeneral": "Evaluación pedagógica general basada en el prospecto de admisión",
  "enfoqueUniversidad": "Consejo técnico adaptado al perfil del examen de admisión objetivo",
  "puntosFuertes": ["Materia o destreza destacada 1", "Materia o destreza destacada 2"],
  "areasMejora": ["Materia con riesgo 1", "Materia con riesgo 2"],
  "planEstudio": [
    "Semana 1: Acción de refuerzo concreta",
    "Semana 2: Simulacro o práctica dirigida",
    "Semana 3: Meta de puntaje"
  ]
}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    const jsonResponse = JSON.parse(responseText);
    return res.json(jsonResponse);

  } catch (error) {
    console.error('Error en /tutor-ia/diagnostico:', error);
    return res.status(500).json({
      error: 'Error procesando el diagnóstico con IA: ' + error.message
    });
  }
});

// ============================================================================
// ENDPOINT 2: Chat Interactivo del Tutor IA (Consumido por TutorIAPage.jsx)
// ============================================================================
router.post('/tutor-ia', async (req, res) => {
  try {
    const { pregunta, estudiante } = req.body;

    if (!pregunta) {
      return res.status(400).json({ error: 'La pregunta no puede estar vacía.' });
    }

    const model = getModelConfig();

    const prompt = `
Eres el Tutor IA de AcadeSys, mentor pedagógico preuniversitario en Perú (UNI, San Marcos, UNFV).
Responde con tono constructivo, didáctico y resolutivo.

CONTEXTO DEL ESTUDIANTE:
${estudiante ? JSON.stringify(estudiante) : 'Estudiante de nivel secundario / preuniversitario.'}

PREGUNTA:
"${pregunta}"

INSTRUCCIONES DE RESPUESTA:
- Explica el concepto y brinda un ejemplo o recomendación práctica ligada al estilo de preguntas de admisión UNI o UNMSM.
- Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura:
{
  "respuesta": "Tu explicación en 1 o 2 párrafos pedagógicos y concisos.",
  "consejoAdmision": "Tip estratégico de examen relacionado con el tema consultado."
}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    const jsonResponse = JSON.parse(responseText);
    return res.json(jsonResponse);

  } catch (error) {
    console.error('Error en /tutor-ia:', error);
    return res.status(500).json({
      error: 'Error en consulta interactiva con IA: ' + error.message,
      respuesta: 'Ocurrió un error al contactar al tutor virtual. Por favor, reintenta.'
=======
router.post("/tutor-ia/diagnostico", async (req, res) => {
  try {
    const { alumno, historialNotas } = req.body;

    // Validación defensiva
    if (!alumno || !historialNotas) {
      return res.status(400).json({
        error: "Debes enviar los datos del 'alumno' y su 'historialNotas'.",
      });
    }

    const prompt = `
      Eres un tutor académico pedagógico experto en academias preuniversitarias.
      Analiza el siguiente perfil y su historial de calificaciones:
      - Alumno: ${alumno.nombre || "Estudiante"}
      - Aula/Ciclo: ${alumno.aula || "General"}
      - Promedio Actual: ${alumno.promedio ?? "Sin promedio"}
      - Evaluaciones: ${JSON.stringify(historialNotas)}

      Genera un diagnóstico académico y plan de estudio adaptado a su rendimiento.
    `;

    // Configuración con JSON forzado nativo para evitar fallos de parseo
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    return res.status(200).json(JSON.parse(responseText));
  } catch (error) {
    console.error("Error en Tutor IA:", error.message);
    return res.status(500).json({
      error: "Error procesando el diagnóstico con IA: " + error.message,
>>>>>>> 66a4a098baf469a33c726e91130c659bc7a5c56e
    });
  }
});

module.exports = router;