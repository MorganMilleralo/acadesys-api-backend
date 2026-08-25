package com.acadesys.backend.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PingController {

    @GetMapping("/ping")
    public String ping() {
        return "¡Hola Mundo! El backend de AcadeSys está vivo y listo para el Frontend.";
    }
}