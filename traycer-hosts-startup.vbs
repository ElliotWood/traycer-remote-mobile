' Starts the Traycer hosts server at logon with no console window.
' Placed in the Startup folder rather than registered as a Scheduled Task:
' Startup needs no administrator rights, and it runs in the logged-on user's
' session, which is where ~/.traycer/host/pid.json is readable.
'
' Verify it is actually up after a reboot by opening http://localhost:5299 -
' a server that silently is not running looks exactly like one that is until
' you try to load the page.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\gigaf\.traycer\scratch\upstream-mobile-web"
shell.Run "node serve-web.mjs 5299", 0, False
