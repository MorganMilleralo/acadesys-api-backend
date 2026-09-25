const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const tutorHandler = async (req, res) => {
  try {
    const { alumno, estudiante, historialNotas, historialSimulacros, pregunta } = req.body;

    const nombreEstudiante = (alumno && alumno.nombre) || estudiante || "Estudiante";
    const notas = historialNotas || historialSimulacros || [];

    const prompt = `
      Eres un tutor pedagógico preuniversitario experto de AcadeSys.
      Estudiante: ${nombreEstudiante}
      Pregunta/Contexto: ${pregunta || "Diagnóstico general de rendimiento"}
      Historial de Evaluaciones: ${JSON.stringify(notas)}

      Responde únicamente en formato JSON con la siguiente estructura:
      {
        "resumenGeneral": "Evaluación breve y directa",
        "puntosFuertes": ["Tema o habilidad destacada"],
        "areasMejora": ["Puntos críticos que debe reforzar"],
        "planEstudio": ["Recomendación de estudio inmediata"]
      }
    `;

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
      error: "Error procesando la consulta con IA: " + error.message,
    });
  }
};

// Rutas duales compatibles
router.post("/tutor-ia", tutorHandler);
router.post("/tutor-ia/diagnostico", tutorHandler);

module.exports = router;