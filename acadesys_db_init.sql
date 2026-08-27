ALTER TABLE OpcionesMenu
ADD CONSTRAINT FK_OpcionesMenu_Padre
FOREIGN KEY (IdPadre) REFERENCES OpcionesMenu(IdOpcionMenu);