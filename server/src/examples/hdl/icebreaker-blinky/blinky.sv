`timescale 1ns / 1ps

// iCEBreaker 闪灯：
//   · 板载红 / 绿 LED 每 0.5 s 交替闪烁；
//   · PMOD2 扩展板上的 5 个 LED 以二进制显示经过的秒数；
//   · 按住用户按键 BTN_N 时闪烁速度提高到 4 倍。
// 分频系数由参数 CLK_HZ 推导：虚拟开发板构建时会把它改小，使效果在浏览器里实时可见。
module blinky #(
  parameter CLK_HZ = 12_000_000   // 输入时钟频率（Hz）
) (
  input  logic       clk,         // 12 MHz
  input  logic       btn_n,       // 用户按键，按下为 0
  output logic       led_r_n,     // 红灯，低电平点亮
  output logic       led_g_n,     // 绿灯，低电平点亮
  output logic [4:0] led          // PMOD2 LED1~LED5，高电平点亮
);
  localparam HALF = CLK_HZ / 2;               // 0.5 s 对应的时钟数
  localparam CW   = $clog2(HALF + 4);

  logic [CW-1:0] cnt    = '0;
  logic          phase  = 1'b0;
  logic [4:0]    secs   = '0;
  logic          btn_s0 = 1'b1;
  logic          btn_s  = 1'b1;

  always_ff @(posedge clk) begin
    // 按键是异步输入：先用两级触发器同步
    btn_s0 <= btn_n;
    btn_s  <= btn_s0;

    if (cnt >= CW'(HALF - 1)) begin
      cnt   <= '0;
      phase <= ~phase;
      if (phase) secs <= secs + 5'd1;        // 每两个半周期 = 1 s
    end else begin
      cnt <= cnt + (btn_s ? CW'(1) : CW'(4));  // 按下时步进 4，加速 4 倍
    end
  end

  assign led_r_n = phase;    // phase = 0 时红灯亮
  assign led_g_n = ~phase;   // phase = 1 时绿灯亮
  assign led     = secs;
endmodule
