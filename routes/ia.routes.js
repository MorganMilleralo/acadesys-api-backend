const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const tutorHandler = async (req, res) => {
  try {
    const { alumno, estudiante, historialNotas, historialSimulacros, pregunta } = req.body;

    const nombreEstudiante = (alumno && alumno.nombre) || estudiante || "Estudiante";
    const notas = historialNotas || historialSimulacros || [];

    // Prompt adaptado: permite diagnósticos y conversación interactiva fluida
    const prompt = `
      Eres un tutor pedagógico preuniversitario experto de AcadeSys.
      Estudiante: ${nombreEstudiante}
      Consulta/Pregunta del estudiante: ${pregunta || "Diagnóstico general de rendimiento"}
      Historial de Evaluaciones: ${JSON.stringify(notas)}

      Responde ÚNICAMENTE en formato JSON con la siguiente estructura exacta:
      {
        "respuesta": "Tu mensaje o respuesta pedagógica directa, amigable y motivadora para el alumno",
        "resumenGeneral": "Evaluación breve y directa de su rendimiento",
        "puntosFuertes": ["Tema o habilidad destacada"],
        "areasMejora": ["Puntos críticos que debe reforzar"],
        "planEstudio": ["Recomendación de estudio inmediata"]
      }
    `;

    // Se actualiza al modelo actual compatible
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const dataParsed = JSON.parse(responseText);

    // Aseguramos compatibilidad total con api.js y TutorIAPage
    return res.status(200).json({
      ...dataParsed,
      mensaje: dataParsed.respuesta,
      analisis: dataParsed.respuesta
    });
  } catch (error) {
    console.error("Error en Tutor IA:", error.message);
    return res.status(500).json({
      error: "Error procesando la consulta con IA: " + error.message,
    });
  }
};

// Rutas duales compatibles
router.post("/tutor-ia", tutorHandler);
router.post("/tutor-ia/diagnostico", tutorHandler);

module.exports = router;