@echo off
cls

If "%1%"=="x" (
	echo Clean
 	cargo clean
) ELSE (
	If "%2%"=="x" (
		echo Clean
		cargo clean
	)
)

IF "%1"=="r" (
 	echo Release
 	cargo build --release
) ELSE (
	IF "%2"=="r" (
		echo Release
		cargo build --release
	) ELSE (
		echo Debug
		cargo build
	)
)

